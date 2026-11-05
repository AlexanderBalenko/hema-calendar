using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api.Tests;

/// <summary>
/// Импорт: то место, где сервис легче всего задваивает данные. Проверяется ровно это — повторный
/// прогон, похожий турнир из другого источника и замена номинаций.
/// </summary>
public class ImportTests : HttpTestBase
{
    private record Nom(string? weaponCode, string? weaponText, string gender, int? minAge, int? maxAge,
        bool isTeam, bool isBeginnerFriendly, string? notes);

    private static object Item(string title, string sourceKey, string startsAt, string source = "Hemagon",
        string? cityName = null, string? endsAt = null, object[]? nominations = null) => new
    {
        source,
        sourceKey,
        title,
        startsAt,
        endsAt,
        cityName,
        organizerName = (string?)null,
        externalUrl = (string?)null,
        description = (string?)null,
        locationManual = (string?)null,
        nominations = nominations ?? [],
    };

    private async Task<ImportResultDto> Import(params object[] batch) =>
        await (await AdminClient().PostJson("/api/admin/events/import", batch)).ReadAs<ImportResultDto>();

    private async Task SeedDirectories()
    {
        await WithDb(async db =>
        {
            db.Cities.AddRange(
                new City { Name = "Казань", MacroRegion = "Поволжье", CountryCode = "RU" },
                new City { Name = "Москва", MacroRegion = "Центр", CountryCode = "RU" });
            db.Weapons.AddRange(
                new Weapon { Name = "Сабля", Code = "saber", SortOrder = 1 },
                new Weapon { Name = "Рапира", Code = "rapier", SortOrder = 2 });
            await db.SaveChangesAsync();
        });
    }

    [Fact]
    public async Task Повторный_прогон_обновляет_запись_и_не_создаёт_вторую()
    {
        var first = await Import(Item("Кубок севера", "hemagon-1", "2027-03-14"));
        Assert.Equal(1, first.Created);

        var second = await Import(Item("Кубок севера 2027", "hemagon-1", "2027-03-15", endsAt: "2027-03-16"));
        Assert.Equal(0, second.Created);
        Assert.Equal(1, second.Updated);

        await WithDb(async db =>
        {
            var ev = await db.Events.SingleAsync();
            Assert.Equal("Кубок севера 2027", ev.Title);
            Assert.Equal(DateOnly.Parse("2027-03-16"), ev.EndsAt);
            // Слаг остаётся прежним: по нему уже могли дать ссылку.
            Assert.Equal("kubok-severa-2027-03-14", ev.Slug);
        });
    }

    [Fact]
    public async Task Похожий_турнир_в_тот_же_день_и_город_не_заводится_второй_записью()
    {
        await SeedDirectories();
        await Import(Item("Level One: Кубань", "sheet-1", "2027-04-03", source: "Spreadsheet", cityName: "Москва"));

        // Тот же турнир из другого источника и под другим написанием: ключи источников разные,
        // связать их может только сравнение названий.
        var result = await Import(Item("LEVEL ONE: KUBAN", "hemagon-9", "2027-04-03", cityName: "Москва"));

        Assert.Equal(0, result.Created);
        Assert.Equal(1, result.Skipped);
        Assert.Contains(result.Warnings, w => w.Contains("похож"));
        await WithDb(async db => Assert.Equal(1, await db.Events.CountAsync()));
    }

    [Fact]
    public async Task Слитное_и_раздельное_написание_считается_одним_турниром()
    {
        await SeedDirectories();
        await Import(Item("Saber Meister", "sheet-2", "2027-05-08", source: "Spreadsheet", cityName: "Казань"));

        var result = await Import(Item("SaberMeister", "sheet-3", "2027-05-08", source: "Spreadsheet", cityName: "Казань"));

        Assert.Equal(1, result.Skipped);
        await WithDb(async db => Assert.Equal(1, await db.Events.CountAsync()));
    }

    [Fact]
    public async Task Два_разных_турнира_в_один_день_в_одном_городе_живут_оба()
    {
        await SeedDirectories();
        // Реальный случай 03.04.2027 в Казани: личный и командный зачёты — разные турниры.
        await Import(Item("Алга! Личный зачёт", "sheet-4", "2027-04-03", source: "Spreadsheet", cityName: "Казань"));
        var result = await Import(Item("Ак Барс Открытый", "sheet-5", "2027-04-03", source: "Spreadsheet", cityName: "Казань"));

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.Skipped);
        await WithDb(async db => Assert.Equal(2, await db.Events.CountAsync()));
    }

    [Fact]
    public async Task Турниры_в_разных_городах_в_один_день_не_считаются_дублем()
    {
        await SeedDirectories();
        await Import(Item("Открытый кубок", "sheet-6", "2027-06-12", source: "Spreadsheet", cityName: "Казань"));
        var result = await Import(Item("Открытый кубок", "hemagon-7", "2027-06-12", cityName: "Москва"));

        Assert.Equal(1, result.Created);
        await WithDb(async db => Assert.Equal(2, await db.Events.CountAsync()));
    }

    [Fact]
    public async Task Номинации_заменяются_целиком_а_не_дописываются()
    {
        await SeedDirectories();
        await Import(Item("Турнир с номинациями", "hemagon-2", "2027-07-01", nominations: [
            new Nom("saber", null, "Any", null, null, false, false, "сабля"),
            new Nom("rapier", null, "Any", null, null, false, false, "рапира"),
        ]));

        await Import(Item("Турнир с номинациями", "hemagon-2", "2027-07-01", nominations: [
            new Nom("saber", null, "Female", 18, null, true, false, "сабля женская команда"),
        ]));

        await WithDb(async db =>
        {
            var nominations = await db.Nominations.Include(n => n.Weapon).ToListAsync();
            var single = Assert.Single(nominations);
            Assert.Equal("saber", single.Weapon?.Code);
            Assert.Equal(Gender.Female, single.Gender);
            Assert.True(single.IsTeam);
            Assert.Equal(18, single.MinAge);
        });
    }

    [Fact]
    public async Task Нераспознанное_оружие_и_неизвестный_город_не_теряются_а_попадают_в_отчёт()
    {
        await SeedDirectories();
        var result = await Import(Item("Турнир в глуши", "hemagon-3", "2027-08-01", cityName: "Кологрив",
            nominations: [new Nom(null, "Катана", "Any", null, null, false, false, null)]));

        Assert.Equal(1, result.Created);
        Assert.Contains(result.Warnings, w => w.Contains("Кологрив"));
        await WithDb(async db =>
        {
            var ev = await db.Events.Include(e => e.Nominations).SingleAsync();
            Assert.Null(ev.CityId);
            Assert.Equal("Кологрив", ev.LocationManual);
            Assert.Equal("Катана", ev.Nominations.Single().WeaponText);
        });
    }

    [Fact]
    public async Task Импортированные_турниры_сразу_опубликованы()
    {
        await Import(Item("Из хемагона", "hemagon-4", "2027-09-01"));

        var calendar = await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(["Из хемагона"], calendar.Select(e => e.Title));
    }

    [Fact]
    public async Task Справочники_доливаются_и_ничего_не_удаляют()
    {
        await SeedDirectories();

        var response = await AdminClient().PutAsJsonAsync("/api/admin/directories", new
        {
            cities = new[] { new { name = "Казань", macroRegion = "Поволжье", countryCode = "RU" },
                             new { name = "Тбилиси", macroRegion = "Зарубежье", countryCode = "GE" } },
            weapons = new[] { new { name = "Сабля", code = "saber", sortOrder = 5 } },
        }, CalendarApp.Json);
        response.EnsureSuccessStatusCode();

        await WithDb(async db =>
        {
            // Москвы и рапиры в заливке не было — но они остались: удалять город, на который
            // ссылается событие, нельзя.
            Assert.Equal(3, await db.Cities.CountAsync());
            Assert.Equal(2, await db.Weapons.CountAsync());
            Assert.Equal("GE", (await db.Cities.SingleAsync(c => c.Name == "Тбилиси")).CountryCode);
            Assert.Equal(5, (await db.Weapons.SingleAsync(w => w.Code == "saber")).SortOrder);
        });
    }

    [Fact]
    public async Task Импорт_закрыт_тем_же_ключом_что_и_очередь()
    {
        var response = await Client.PostJson("/api/admin/events/import", new[] { Item("Мимо", "x-1", "2027-10-01") });
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
        await WithDb(async db => Assert.Equal(0, await db.Events.CountAsync()));
    }
}
