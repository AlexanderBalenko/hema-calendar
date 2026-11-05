using System.Net;
using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api.Tests;

/// <summary>Очередь модерации: кого пускает ключ и что делают решения.</summary>
public class ModerationTests : HttpTestBase
{
    private async Task<Guid> Submit(string title = "Турнир «Заявка»")
    {
        await Client.PostJson("/api/submissions", new
        {
            title,
            startsAt = "2027-11-07",
            contact = "telegram @author",
            note = "заметка",
        });

        Guid id = Guid.Empty;
        await WithDb(async db => id = (await db.Events.FirstAsync(e => e.Title == title)).Id);
        return id;
    }

    [Fact]
    public async Task Без_ключа_и_с_чужим_ключом_очередь_не_открывается()
    {
        await Submit();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Client.GetAsync("/api/admin/submissions")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await AdminClient("не-тот-ключ").GetAsync("/api/admin/submissions")).StatusCode);

        // Парный разрешённый сценарий: с правильным ключом заявка видна — значит, отказ выше
        // сработал на ключе, а не на пустой очереди.
        var queue = await (await AdminClient().GetAsync("/api/admin/submissions")).ReadAs<List<ModerationItemDto>>();
        Assert.Single(queue);
        Assert.Equal("telegram @author", queue[0].SubmitterContact);
    }

    [Fact]
    public async Task Одобрение_публикует_турнир()
    {
        var id = await Submit("Турнир «Одобренный»");

        var response = await AdminClient().PostAsync($"/api/admin/submissions/{id}/approve", null);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var calendar = await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>();
        Assert.Equal(["Турнир «Одобренный»"], calendar.Select(e => e.Title));
        Assert.Empty(await (await AdminClient().GetAsync("/api/admin/submissions")).ReadAs<List<ModerationItemDto>>());
    }

    [Fact]
    public async Task Отказ_прячет_турнир_и_запоминает_причину()
    {
        var id = await Submit("Турнир «Отклонённый»");

        var response = await AdminClient().PostJson($"/api/admin/submissions/{id}/reject", new { reason = "дубль хемагона" });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        Assert.Empty(await (await Client.GetAsync("/api/calendar")).ReadAs<List<CalendarEventDto>>());
        await WithDb(async db =>
        {
            var ev = await db.Events.SingleAsync();
            Assert.Equal(ModerationStatus.Rejected, ev.Status);
            Assert.Equal("дубль хемагона", ev.RejectionReason);
            Assert.NotNull(ev.ReviewedAt);
        });
    }

    [Fact]
    public async Task Решение_по_несуществующей_заявке_404()
    {
        var response = await AdminClient().PostAsync($"/api/admin/submissions/{Guid.NewGuid()}/approve", null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

/// <summary>
/// Забытая переменная окружения не должна открыть очередь всем: пустой ожидаемый ключ закрывает
/// маршрут совсем. Отдельный класс — потому что ключ задаётся при старте приложения.
/// </summary>
public class ModerationWithoutKeyTests : HttpTestBase
{
    protected override string ConfiguredAdminKey => "";

    [Fact]
    public async Task Пустой_ключ_в_конфиге_закрывает_очередь_а_не_открывает()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/admin/submissions")).StatusCode);
        // И «угаданный» пустой ключ тоже не проходит — иначе проверка выше ничего бы не значила.
        Assert.Equal(HttpStatusCode.NotFound, (await AdminClient("").GetAsync("/api/admin/submissions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AdminClient("что угодно").GetAsync("/api/admin/submissions")).StatusCode);

        // Публичное чтение при этом работает: закрыта очередь, а не сервис.
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync("/api/calendar")).StatusCode);
    }
}
