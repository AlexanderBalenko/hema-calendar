using System.Net;
using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api.Tests;

/// <summary>Приём заявок: что сохраняется, что отвергается и как молчит ловушка для ботов.</summary>
public class SubmissionTests : HttpTestBase
{
    private static object Submission(string title = "Турнир «Проверка»", string startsAt = "2027-09-05",
        string? endsAt = null, string? website = null, object[]? nominations = null) => new
    {
        title,
        startsAt,
        endsAt,
        locationManual = "Тула, зал «Проверка»",
        organizerName = "Клуб «Проверка»",
        externalUrl = "https://example.org/t",
        description = "Описание",
        contact = "telegram @check",
        note = "заметка модератору",
        nominations = nominations ?? [],
        website,
    };

    [Fact]
    public async Task Заявка_ложится_в_очередь_непубликованной_и_с_контактом()
    {
        var response = await Client.PostJson("/api/submissions", Submission());
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        await WithDb(async db =>
        {
            var saved = await db.Events.SingleAsync();
            Assert.Equal(ModerationStatus.Pending, saved.Status);
            Assert.Equal(EventSource.Submission, saved.Source);
            Assert.Equal("telegram @check", saved.SubmitterContact);
            Assert.Equal(DateOnly.Parse("2027-09-05"), saved.EndsAt);
            Assert.False(string.IsNullOrWhiteSpace(saved.Slug), "слаг должен быть собран сервисом");
        });

        // И главное: в календаре её ещё нет.
        var calendar = await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>();
        Assert.Empty(calendar);
    }

    [Fact]
    public async Task Номинации_заявки_сохраняются_со_ссылкой_на_справочник()
    {
        int saberId = 0;
        await WithDb(async db =>
        {
            var saber = new Weapon { Name = "Сабля", Code = "saber", SortOrder = 1 };
            db.Weapons.Add(saber);
            await db.SaveChangesAsync();
            saberId = saber.Id;
        });

        await Client.PostJson("/api/submissions", Submission(nominations: [
            new { weaponId = saberId, weaponText = (string?)null, gender = "Female", minAge = 18, maxAge = (int?)null, isTeam = false, isBeginnerFriendly = true, notes = (string?)null },
            new { weaponId = (int?)null, weaponText = "Катана", gender = "Any", minAge = (int?)null, maxAge = (int?)null, isTeam = true, isBeginnerFriendly = false, notes = (string?)null },
        ]));

        await WithDb(async db =>
        {
            var nominations = await db.Nominations.OrderBy(n => n.SortOrder).ToListAsync();
            Assert.Equal(2, nominations.Count);
            Assert.Equal(saberId, nominations[0].WeaponId);
            Assert.Equal(Gender.Female, nominations[0].Gender);
            Assert.True(nominations[0].IsBeginnerFriendly);
            Assert.Null(nominations[1].WeaponId);
            Assert.Equal("Катана", nominations[1].WeaponText);
            Assert.True(nominations[1].IsTeam);
        });
    }

    [Fact]
    public async Task Ловушка_для_ботов_отвечает_успехом_и_ничего_не_пишет()
    {
        var response = await Client.PostJson("/api/submissions", Submission(website: "https://spam.example"));

        // Бот не должен понять, что пойман: код тот же, что у настоящей заявки.
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await WithDb(async db => Assert.Equal(0, await db.Events.CountAsync()));
    }

    [Fact]
    public async Task Короткое_название_и_перевёрнутые_даты_отвергаются_с_объяснением()
    {
        var shortTitle = await Client.PostJson("/api/submissions", Submission(title: "ОК"));
        Assert.Equal(HttpStatusCode.BadRequest, shortTitle.StatusCode);
        Assert.Contains("Название", await shortTitle.Content.ReadAsStringAsync());

        var reversed = await Client.PostJson("/api/submissions", Submission(startsAt: "2027-09-10", endsAt: "2027-09-01"));
        Assert.Equal(HttpStatusCode.BadRequest, reversed.StatusCode);

        var ancient = await Client.PostJson("/api/submissions", Submission(startsAt: "2010-01-01"));
        Assert.Equal(HttpStatusCode.BadRequest, ancient.StatusCode);

        await WithDb(async db => Assert.Equal(0, await db.Events.CountAsync()));
    }
}

/// <summary>
/// Лимит заявок — отдельным классом: у него своя база И своё приложение, потому что счётчики
/// лимитера живут в памяти хоста, а не в базе (грабли портала: тесты лимитера, делящие
/// приложение с соседями, зеленеют или краснеют по порядку запуска).
/// </summary>
public class SubmissionRateLimitTests : HttpTestBase
{
    protected override int SubmissionsPerHour => 2;

    [Fact]
    public async Task Третья_заявка_за_час_получает_429()
    {
        var client = Client;
        object body(int i) => new { title = $"Турнир номер {i}", startsAt = "2027-10-01", contact = "@a" };

        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJson("/api/submissions", body(1))).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJson("/api/submissions", body(2))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostJson("/api/submissions", body(3))).StatusCode);

        // Первые две — не «а вдруг и их не приняли»: в базе ровно две.
        await WithDb(async db => Assert.Equal(2, await db.Events.CountAsync()));
    }
}
