using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api;

public static class Endpoints
{
    /// <summary>Заголовок с ключом модератора. Учётных записей в сервисе нет вовсе — ключ в
    /// окружении, и это единственное, что отделяет очередь от публики.</summary>
    private const string AdminHeader = "X-Calendar-Admin-Key";

    public static void MapCalendar(this WebApplication app)
    {
        app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

        // ---- Публичное чтение: без токенов, без кук, без личных данных ----

        app.MapGet("/api/calendar", async (
            DateOnly? from,
            DateOnly? to,
            string? weapons,
            string? regions,
            int? cityId,
            bool? team,
            bool? beginner,
            string? q,
            CalendarDb db) =>
        {
            var query = db.Events
                .AsNoTracking()
                .Where(e => e.Status == ModerationStatus.Approved);

            if (from is { } f) query = query.Where(e => e.EndsAt >= f);
            if (to is { } t) query = query.Where(e => e.StartsAt <= t);
            if (cityId is { } city) query = query.Where(e => e.CityId == city);

            var weaponCodes = Split(weapons);
            if (weaponCodes.Length > 0)
                query = query.Where(e => e.Nominations.Any(n => n.Weapon != null && weaponCodes.Contains(n.Weapon.Code)));

            var regionNames = Split(regions);
            if (regionNames.Length > 0)
                query = query.Where(e => e.City != null && regionNames.Contains(e.City.MacroRegion));

            if (team == true) query = query.Where(e => e.Nominations.Any(n => n.IsTeam));
            if (beginner == true) query = query.Where(e => e.Nominations.Any(n => n.IsBeginnerFriendly));

            if (!string.IsNullOrWhiteSpace(q))
            {
                var needle = q.Trim();
                query = query.Where(e =>
                    EF.Functions.ILike(e.Title, $"%{needle}%") ||
                    (e.OrganizerName != null && EF.Functions.ILike(e.OrganizerName, $"%{needle}%")));
            }

            // Тай-брейк по Id обязателен: без него две записи одного дня идут в непредсказуемом
            // порядке и страница «прыгает» между запросами.
            var events = await query
                .Include(e => e.City)
                .Include(e => e.Nominations).ThenInclude(n => n.Weapon)
                .OrderBy(e => e.StartsAt).ThenBy(e => e.Title).ThenBy(e => e.Id)
                .Take(2000)
                .ToListAsync();

            return Results.Ok(events.Select(ToDto).ToList());
        });

        app.MapGet("/api/calendar/events/{slug}", async (string slug, CalendarDb db) =>
        {
            var ev = await db.Events
                .AsNoTracking()
                .Include(e => e.City)
                .Include(e => e.Nominations).ThenInclude(n => n.Weapon)
                .FirstOrDefaultAsync(e => e.Slug == slug && e.Status == ModerationStatus.Approved);

            return ev is null ? Results.NotFound() : Results.Ok(new EventDetailsDto(ToDto(ev), ev.Description));
        });

        app.MapGet("/api/directories", async (CalendarDb db) =>
        {
            var weapons = await db.Weapons.AsNoTracking().OrderBy(w => w.SortOrder).ThenBy(w => w.Name)
                .Select(w => new WeaponDto(w.Id, w.Name, w.Code)).ToListAsync();
            var cities = await db.Cities.AsNoTracking().OrderBy(c => c.Name)
                .Select(c => new CityDto(c.Id, c.Name, c.MacroRegion, c.CountryCode)).ToListAsync();
            var regions = cities.Select(c => c.MacroRegion).Distinct().OrderBy(r => r).ToList();
            return Results.Ok(new DirectoriesDto(weapons, cities, regions));
        });

        // ---- Приём заявок: аноним, но с тормозами ----

        app.MapPost("/api/submissions", async (SubmitEventRequest request, CalendarDb db) =>
        {
            // Ловушка сработала — отвечаем как при успехе: бот не должен узнать, что его поймали.
            if (!string.IsNullOrWhiteSpace(request.Website)) return Results.Accepted();

            if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length < 3)
                return Results.BadRequest(new { error = "Название турнира обязательно." });

            var start = request.StartsAt;
            var end = request.EndsAt ?? start;
            if (end < start) return Results.BadRequest(new { error = "Дата окончания раньше даты начала." });
            if (start < DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-5)))
                return Results.BadRequest(new { error = "Слишком старая дата — такие турниры заводит импорт, не форма." });

            var ev = new CalendarEvent
            {
                Id = Guid.NewGuid(),
                Slug = await UniqueSlugAsync(db, request.Title, start),
                Title = request.Title.Trim(),
                Description = Trim(request.Description, 4000),
                StartsAt = start,
                EndsAt = end,
                CityId = request.CityId,
                LocationManual = Trim(request.LocationManual, 256),
                OrganizerName = Trim(request.OrganizerName, 200),
                ExternalUrl = Trim(request.ExternalUrl, 512),
                Source = EventSource.Submission,
                Status = ModerationStatus.Pending,
                SubmitterContact = Trim(request.Contact, 200),
                SubmitterNote = Trim(request.Note, 2000),
                CreatedAt = DateTimeOffset.UtcNow,
            };

            var order = 0;
            foreach (var n in request.Nominations ?? [])
            {
                ev.Nominations.Add(new Nomination
                {
                    Id = Guid.NewGuid(),
                    WeaponId = n.WeaponId,
                    WeaponText = Trim(n.WeaponText, 120),
                    Gender = n.Gender,
                    MinAge = n.MinAge,
                    MaxAge = n.MaxAge,
                    IsTeam = n.IsTeam,
                    IsBeginnerFriendly = n.IsBeginnerFriendly,
                    Notes = Trim(n.Notes, 500),
                    SortOrder = order++,
                });
            }

            db.Events.Add(ev);
            await db.SaveChangesAsync();
            return Results.Accepted();
        }).RequireRateLimiting("submit");

        // ---- Модерация: ключом из окружения ----

        var admin = app.MapGroup("/api/admin").AddEndpointFilter(AdminKeyFilter);

        admin.MapGet("/submissions", async (CalendarDb db) =>
        {
            var items = await db.Events.AsNoTracking()
                .Include(e => e.City)
                .Include(e => e.Nominations).ThenInclude(n => n.Weapon)
                .Where(e => e.Status == ModerationStatus.Pending)
                .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
                .ToListAsync();

            return Results.Ok(items.Select(e => new ModerationItemDto(
                e.Id, e.Title, e.StartsAt, e.EndsAt, e.City?.Name, e.LocationManual, e.OrganizerName,
                e.ExternalUrl, e.Description, e.SubmitterContact, e.SubmitterNote, e.Source, e.CreatedAt,
                e.Nominations.OrderBy(n => n.SortOrder).Select(ToDto).ToList())).ToList());
        });

        admin.MapPost("/submissions/{id:guid}/approve", async (Guid id, CalendarDb db) =>
            await DecideAsync(db, id, ModerationStatus.Approved, null));

        admin.MapPost("/submissions/{id:guid}/reject", async (Guid id, [FromBody] RejectRequest? body, CalendarDb db) =>
            await DecideAsync(db, id, ModerationStatus.Rejected, body?.Reason));
    }

    private static async Task<IResult> DecideAsync(CalendarDb db, Guid id, ModerationStatus status, string? reason)
    {
        var ev = await db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (ev is null) return Results.NotFound();

        ev.Status = status;
        ev.RejectionReason = status == ModerationStatus.Rejected ? Trim(reason, 500) : null;
        ev.ReviewedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async ValueTask<object?> AdminKeyFilter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var expected = context.HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()["Admin:Key"];

        // Пустой ключ НЕ открывает очередь всем: пустое ожидание закрывает маршрут совсем —
        // иначе забытая переменная окружения тихо публикует контакты заявителей.
        if (string.IsNullOrWhiteSpace(expected)) return Results.NotFound();

        var provided = context.HttpContext.Request.Headers[AdminHeader].ToString();
        if (!CryptographicEquals(provided, expected)) return Results.Unauthorized();

        return await next(context);
    }

    /// <summary>Сравнение за постоянное время: обычное == выдаёт длину и первые совпавшие байты.</summary>
    private static bool CryptographicEquals(string a, string b)
    {
        var left = System.Text.Encoding.UTF8.GetBytes(a);
        var right = System.Text.Encoding.UTF8.GetBytes(b);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static async Task<string> UniqueSlugAsync(CalendarDb db, string title, DateOnly start)
    {
        var baseSlug = $"{Slugify(title)}-{start:yyyy-MM-dd}";
        var slug = baseSlug;
        var suffix = 2;
        while (await db.Events.AnyAsync(e => e.Slug == slug))
            slug = $"{baseSlug}-{suffix++}";
        return slug;
    }

    private static string Slugify(string value)
    {
        var map = new Dictionary<char, string>
        {
            ['а'] = "a", ['б'] = "b", ['в'] = "v", ['г'] = "g", ['д'] = "d", ['е'] = "e", ['ё'] = "e",
            ['ж'] = "zh", ['з'] = "z", ['и'] = "i", ['й'] = "y", ['к'] = "k", ['л'] = "l", ['м'] = "m",
            ['н'] = "n", ['о'] = "o", ['п'] = "p", ['р'] = "r", ['с'] = "s", ['т'] = "t", ['у'] = "u",
            ['ф'] = "f", ['х'] = "h", ['ц'] = "ts", ['ч'] = "ch", ['ш'] = "sh", ['щ'] = "sch", ['ъ'] = "",
            ['ы'] = "y", ['ь'] = "", ['э'] = "e", ['ю'] = "yu", ['я'] = "ya",
        };
        var sb = new System.Text.StringBuilder();
        foreach (var ch in value.Trim().ToLowerInvariant())
        {
            if (map.TryGetValue(ch, out var tr)) sb.Append(tr);
            else if (char.IsLetterOrDigit(ch) && ch < 128) sb.Append(ch);
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "event" : slug[..Math.Min(slug.Length, 100)];
    }

    private static string[] Split(string? value) =>
        string.IsNullOrWhiteSpace(value) ? [] : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string? Trim(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, max)];

    private static CalendarEventDto ToDto(CalendarEvent e) => new(
        e.Id, e.Slug, e.Title, e.StartsAt, e.EndsAt,
        e.City?.Name, e.City?.MacroRegion, e.City?.CountryCode,
        e.LocationManual, e.OrganizerName, e.ExternalUrl,
        e.Nominations.OrderBy(n => n.SortOrder).Select(ToDto).ToList());

    private static NominationDto ToDto(Nomination n) => new(
        n.Weapon?.Name ?? n.WeaponText ?? "Не указано",
        n.Weapon?.Code,
        n.Gender, n.MinAge, n.MaxAge, n.IsTeam, n.IsBeginnerFriendly, n.Notes);
}
