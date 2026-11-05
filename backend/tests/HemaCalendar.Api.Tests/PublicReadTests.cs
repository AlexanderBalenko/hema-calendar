using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api.Tests;

/// <summary>Публичное чтение: что видно без всяких ключей и чего не видно никогда.</summary>
public class PublicReadTests : HttpTestBase
{
    private static CalendarEvent Event(string title, string slug, DateOnly start, DateOnly? end = null,
        ModerationStatus status = ModerationStatus.Approved) => new()
    {
        Id = Guid.NewGuid(),
        Slug = slug,
        Title = title,
        StartsAt = start,
        EndsAt = end ?? start,
        Status = status,
        Source = EventSource.Submission,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static DateOnly D(string iso) => DateOnly.Parse(iso);

    [Fact]
    public async Task Календарь_показывает_только_одобренные_турниры()
    {
        await WithDb(async db =>
        {
            db.Events.Add(Event("Опубликованный", "ok", D("2027-03-01")));
            db.Events.Add(Event("На модерации", "pending", D("2027-03-02"), status: ModerationStatus.Pending));
            db.Events.Add(Event("Отклонённый", "rejected", D("2027-03-03"), status: ModerationStatus.Rejected));
            await db.SaveChangesAsync();
        });

        var events = await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>();

        Assert.Equal(["Опубликованный"], events.Select(e => e.Title));
    }

    [Fact]
    public async Task Диапазон_дат_берёт_пересечение_а_не_попадание_начала()
    {
        await WithDb(async db =>
        {
            db.Events.Add(Event("Идёт через границу", "across", D("2027-02-26"), D("2027-03-02")));
            db.Events.Add(Event("Закончился раньше", "before", D("2027-02-01"), D("2027-02-02")));
            db.Events.Add(Event("Начнётся позже", "after", D("2027-04-01")));
            await db.SaveChangesAsync();
        });

        // Турнир, который НАЧАЛСЯ в феврале, но идёт в марте, обязан попасть в мартовскую сетку:
        // иначе в календаре зияет дыра там, где турнир как раз идёт.
        var march = await (await Client.GetAsync("/api/calendar?from=2027-03-01&to=2027-03-31"))
            .ReadAs<List<CalendarEventDto>>();

        Assert.Equal(["Идёт через границу"], march.Select(e => e.Title));
    }

    [Fact]
    public async Task Фильтры_по_оружию_региону_и_новичкам_отбирают_по_существу()
    {
        await WithDb(async db =>
        {
            var saber = new Weapon { Name = "Сабля", Code = "saber", SortOrder = 1 };
            var longsword = new Weapon { Name = "Длинный меч", Code = "longsword", SortOrder = 2 };
            var kazan = new City { Name = "Казань", MacroRegion = "Поволжье", CountryCode = "RU" };
            var moscow = new City { Name = "Москва", MacroRegion = "Центр", CountryCode = "RU" };
            db.AddRange(saber, longsword, kazan, moscow);
            await db.SaveChangesAsync();

            var sabreInKazan = Event("Сабельный в Казани", "saber-kazan", D("2027-05-01"));
            sabreInKazan.City = kazan;
            sabreInKazan.Nominations.Add(new Nomination { Id = Guid.NewGuid(), Weapon = saber, IsBeginnerFriendly = true });

            var swordInMoscow = Event("Мечевой в Москве", "sword-moscow", D("2027-05-02"));
            swordInMoscow.City = moscow;
            swordInMoscow.Nominations.Add(new Nomination { Id = Guid.NewGuid(), Weapon = longsword });

            db.AddRange(sabreInKazan, swordInMoscow);
            await db.SaveChangesAsync();
        });

        var bySaber = await (await Client.GetAsync("/api/calendar?weapons=saber")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(["Сабельный в Казани"], bySaber.Select(e => e.Title));

        var byRegion = await (await Client.GetAsync("/api/calendar?regions=Центр")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(["Мечевой в Москве"], byRegion.Select(e => e.Title));

        var forBeginners = await (await Client.GetAsync("/api/calendar?beginner=true")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(["Сабельный в Казани"], forBeginners.Select(e => e.Title));

        // Контрольный положительный сценарий: без фильтров видно оба — значит, отбор выше
        // отсекал по правилу, а не потому, что данных не было.
        var all = await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(2, all.Count);
    }

    [Fact]
    public async Task Поиск_идёт_по_названию_и_организатору_без_учёта_регистра()
    {
        await WithDb(async db =>
        {
            var byTitle = Event("Меч Ренессанса", "renaissance", D("2027-06-01"));
            var byOrganizer = Event("Кубок города", "cup", D("2027-06-02"));
            byOrganizer.OrganizerName = "Клуб «Ренессанс»";
            db.AddRange(byTitle, byOrganizer);
            await db.SaveChangesAsync();
        });

        var found = await (await Client.GetAsync("/api/calendar?q=ренессанс")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(2, found.Count);
    }

    [Fact]
    public async Task Публичный_ответ_не_отдаёт_контакт_заявителя_и_заметку()
    {
        await WithDb(async db =>
        {
            var ev = Event("С контактом", "with-contact", D("2027-07-01"));
            ev.SubmitterContact = "telegram @secret";
            ev.SubmitterNote = "позвонить вечером";
            ev.RejectionReason = "служебная причина";
            db.Events.Add(ev);
            await db.SaveChangesAsync();
        });

        // Смотрим сырой текст ответа, а не разобранный DTO: лишнее поле появилось бы именно
        // в JSON, а типизированный разбор его молча проглотил бы.
        var list = await (await Client.GetAsync("/api/calendar")).Content.ReadAsStringAsync();
        var details = await (await Client.GetAsync("/api/calendar/events/with-contact")).Content.ReadAsStringAsync();

        foreach (var body in new[] { list, details })
        {
            Assert.DoesNotContain("secret", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("позвонить", body);
            Assert.DoesNotContain("служебная", body);
        }
        Assert.Contains("С контактом", details);
    }

    [Fact]
    public async Task Страница_неопубликованного_турнира_отвечает_404()
    {
        await WithDb(async db =>
        {
            db.Events.Add(Event("На модерации", "hidden", D("2027-08-01"), status: ModerationStatus.Pending));
            await db.SaveChangesAsync();
        });

        var response = await Client.GetAsync("/api/calendar/events/hidden");
        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Справочники_отдают_макрорегионы_без_повторов()
    {
        await WithDb(async db =>
        {
            db.Cities.AddRange(
                new City { Name = "Казань", MacroRegion = "Поволжье", CountryCode = "RU" },
                new City { Name = "Самара", MacroRegion = "Поволжье", CountryCode = "RU" },
                new City { Name = "Москва", MacroRegion = "Центр", CountryCode = "RU" });
            db.Weapons.Add(new Weapon { Name = "Сабля", Code = "saber", SortOrder = 1 });
            await db.SaveChangesAsync();
        });

        var directories = await (await Client.GetAsync("/api/directories")).ReadAs<DirectoriesDto>();

        Assert.Equal(["Поволжье", "Центр"], directories.MacroRegions);
        Assert.Equal(3, directories.Cities.Count);
        Assert.Single(directories.Weapons);
    }
}
