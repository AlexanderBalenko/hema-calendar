using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api;

/// <summary>
/// Импорт справочников и турниров из внешних источников (хемагон, таблицы организаторов).
/// Маршруты лежат под тем же админ-ключом, что и очередь модерации.
/// </summary>
public static class ImportEndpoints
{
    public static void MapImport(this RouteGroupBuilder admin)
    {
        // Справочники приезжают целиком и доливаются: существующие города и оружие обновляются по
        // имени и коду, лишние НЕ удаляются — на удалённый город ссылались бы события.
        admin.MapPut("/directories", async (UpsertDirectoriesRequest request, CalendarDb db) =>
        {
            var cities = await db.Cities.ToDictionaryAsync(c => c.Name);
            var createdCities = 0;
            foreach (var incoming in request.Cities)
            {
                var name = incoming.Name.Trim();
                if (name.Length == 0) continue;

                if (cities.TryGetValue(name, out var city))
                {
                    city.MacroRegion = incoming.MacroRegion.Trim();
                    city.CountryCode = Normalize(incoming.CountryCode);
                }
                else
                {
                    db.Cities.Add(new City
                    {
                        Name = name,
                        MacroRegion = incoming.MacroRegion.Trim(),
                        CountryCode = Normalize(incoming.CountryCode),
                    });
                    createdCities++;
                }
            }

            var weapons = await db.Weapons.ToDictionaryAsync(w => w.Code);
            var createdWeapons = 0;
            foreach (var incoming in request.Weapons)
            {
                var code = incoming.Code.Trim().ToLowerInvariant();
                if (code.Length == 0) continue;

                if (weapons.TryGetValue(code, out var weapon))
                {
                    weapon.Name = incoming.Name.Trim();
                    weapon.SortOrder = incoming.SortOrder;
                }
                else
                {
                    db.Weapons.Add(new Weapon { Name = incoming.Name.Trim(), Code = code, SortOrder = incoming.SortOrder });
                    createdWeapons++;
                }
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { createdCities, createdWeapons, totalCities = cities.Count + createdCities });
        });

        admin.MapPost("/events/import", async (IReadOnlyList<ImportEventRequest> batch, CalendarDb db) =>
        {
            // Удаление номинаций идёт отдельным запросом (ExecuteDelete), то есть вне SaveChanges,
            // поэтому вся пачка живёт в одной транзакции: иначе обрыв посередине оставил бы турнир
            // без номинаций вовсе.
            await using var transaction = await db.Database.BeginTransactionAsync();
            var cities = await db.Cities.ToDictionaryAsync(c => c.Name.ToLowerInvariant(), c => c.Id);
            var weapons = await db.Weapons.ToDictionaryAsync(w => w.Code, w => w.Id);
            var warnings = new List<string>();
            int created = 0, updated = 0, skipped = 0;

            foreach (var item in batch)
            {
                if (string.IsNullOrWhiteSpace(item.SourceKey) || string.IsNullOrWhiteSpace(item.Title))
                {
                    skipped++;
                    warnings.Add($"Пропущено без ключа или названия: «{item.Title}»");
                    continue;
                }

                var end = item.EndsAt ?? item.StartsAt;
                if (end < item.StartsAt)
                {
                    skipped++;
                    warnings.Add($"«{item.Title}»: дата окончания раньше начала");
                    continue;
                }

                int? cityId = null;
                if (!string.IsNullOrWhiteSpace(item.CityName))
                {
                    if (cities.TryGetValue(item.CityName.Trim().ToLowerInvariant(), out var id)) cityId = id;
                    // Города нет в справочнике — не повод терять турнир: место уходит в строку, а
                    // предупреждение в отчёт (правило «не терять данные, а эскалировать»).
                    else warnings.Add($"«{item.Title}»: города «{item.CityName}» нет в справочнике");
                }

                // БЕЗ Include: номинации обновляемого турнира удаляются запросом (см. ниже), а
                // загруженные в трекер они мешали — EF пытался их ОБНОВИТЬ вместо удаления, и
                // повторный прогон импорта падал с DbUpdateConcurrencyException.
                var existing = await db.Events
                    .FirstOrDefaultAsync(e => e.Source == item.Source && e.SourceKey == item.SourceKey);

                // Защита от задвоения между источниками. Один турнир в хемагоне, Google-таблице и
                // графике называется по-разному («Алга!» / «Турнир: "Алга!"», «Level One: Кубань» /
                // «LEVEL ONE: KUBAN»), и ключ источника их не связывает. Поэтому для НОВОЙ записи
                // смотрим, нет ли в тот же день и в том же месте турнира с похожим названием.
                // Найденный — не сливаем молча: пропускаем и говорим человеку, пусть решает.
                // Два разных турнира в один день в одном городе бывают (личный и командный зачёты),
                // поэтому одной даты и города мало — нужна ещё и похожесть названия.
                if (existing is null)
                {
                    var sameDay = await db.Events
                        .Where(e => e.StartsAt == item.StartsAt)
                        .Select(e => new { e.Title, e.Source, e.CityId, e.LocationManual })
                        .ToListAsync();

                    var twin = sameDay.FirstOrDefault(e =>
                        SamePlace(e.CityId, e.LocationManual, cityId, item.LocationManual ?? item.CityName)
                        && TitlesLookAlike(e.Title, item.Title));

                    if (twin is not null)
                    {
                        skipped++;
                        warnings.Add($"«{item.Title}» ({item.StartsAt:yyyy-MM-dd}) похож на уже заведённый "
                                     + $"«{twin.Title}» (источник {twin.Source}) — не завожу второй записью");
                        continue;
                    }
                }

                var ev = existing ?? new CalendarEvent
                {
                    Id = Guid.NewGuid(),
                    Slug = string.Empty,
                    Title = item.Title.Trim(),
                    StartsAt = item.StartsAt,
                    EndsAt = end,
                    Source = item.Source,
                    SourceKey = item.SourceKey.Trim(),
                    // Импорт заводит турниры сразу опубликованными: источник уже прошёл проверку
                    // человеком (хемагон публикует состоявшиеся, таблицы ведут организаторы).
                    Status = ModerationStatus.Approved,
                    CreatedAt = DateTimeOffset.UtcNow,
                };

                ev.Title = item.Title.Trim();
                ev.StartsAt = item.StartsAt;
                ev.EndsAt = end;
                ev.CityId = cityId;
                ev.LocationManual = Limit(item.LocationManual ?? (cityId is null ? item.CityName : null), 256);
                ev.OrganizerName = Limit(item.OrganizerName, 200);
                ev.ExternalUrl = Limit(item.ExternalUrl, 512);
                ev.Description = Limit(item.Description, 4000);

                if (existing is null)
                {
                    ev.Slug = await SlugTools.UniqueAsync(db, ev.Title, ev.StartsAt);
                    db.Events.Add(ev);
                    created++;
                }
                else
                {
                    updated++;
                }

                // Номинации заменяются целиком: источник — единственная правда о составе турнира,
                // а ручных правок здесь никто не делает (в отличие от портала, где их стерегут
                // результаты).
                if (existing is not null)
                    await db.Nominations.Where(n => n.EventId == ev.Id).ExecuteDeleteAsync();

                var order = 0;
                foreach (var n in item.Nominations ?? [])
                {
                    int? weaponId = null;
                    if (!string.IsNullOrWhiteSpace(n.WeaponCode)
                        && weapons.TryGetValue(n.WeaponCode.Trim().ToLowerInvariant(), out var wid)) weaponId = wid;

                    db.Nominations.Add(new Nomination
                    {
                        Id = Guid.NewGuid(),
                        EventId = ev.Id,
                        WeaponId = weaponId,
                        WeaponText = weaponId is null ? Limit(n.WeaponText ?? n.WeaponCode, 120) : null,
                        Gender = n.Gender,
                        MinAge = n.MinAge,
                        MaxAge = n.MaxAge,
                        IsTeam = n.IsTeam,
                        IsBeginnerFriendly = n.IsBeginnerFriendly,
                        Notes = Limit(n.Notes, 500),
                        SortOrder = order++,
                    });
                }
            }

            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(new ImportResultDto(created, updated, skipped, warnings));
        });
    }

    /// <summary>Одно ли это место: по городу справочника, а если его нет — по строке места.</summary>
    private static bool SamePlace(int? leftCityId, string? leftManual, int? rightCityId, string? rightManual)
    {
        if (leftCityId is not null && rightCityId is not null) return leftCityId == rightCityId;
        if (leftCityId is not null || rightCityId is not null) return false;
        return !string.IsNullOrWhiteSpace(leftManual) && !string.IsNullOrWhiteSpace(rightManual)
            && string.Equals(leftManual.Trim(), rightManual.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Похожи ли названия. Сравниваем по словам, а не по строке целиком: источники добавляют к
    /// названию «турнир», год, формат («| HEMA - турнир»), и посимвольное сравнение их не узнаёт.
    /// </summary>
    private static bool TitlesLookAlike(string left, string right)
    {
        var a = TitleWords(left);
        var b = TitleWords(right);
        if (a.Count == 0 || b.Count == 0) return false;

        var common = a.Intersect(b).Count();
        if (common >= Math.Min(a.Count, b.Count) * 0.6) return true;

        // Слитное написание против раздельного: «SaberMeister» и «Saber Meister» по словам не
        // пересекаются вовсе, хотя это один турнир. Сравниваем ещё и сплошную строку из букв.
        var solidA = Letters(string.Concat(a));
        var solidB = Letters(string.Concat(b));
        return solidA.Length >= 6 && solidB.Length >= 6 && (solidA.Contains(solidB) || solidB.Contains(solidA));
    }

    private static readonly string[] NoiseWords =
        ["турнир", "кубок", "открытый", "hema", "по", "на", "и", "the", "of", "2024", "2025", "2026", "2027"];

    private static string Letters(string value) =>
        new(value.Where(char.IsLetterOrDigit).ToArray());

    private static HashSet<string> TitleWords(string title) =>
        title.ToLowerInvariant().Replace('ё', 'е')
            .Split([' ', '"', '«', '»', ':', ',', '.', '-', '–', '—', '(', ')', '|', '!', '?', '\''],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(w => w.Length > 2 && !NoiseWords.Contains(w))
            .ToHashSet();

    private static string Normalize(string? countryCode) =>
        string.IsNullOrWhiteSpace(countryCode) ? "RU" : countryCode.Trim().ToUpperInvariant()[..Math.Min(2, countryCode.Trim().Length)];

    private static string? Limit(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, max)];
}
