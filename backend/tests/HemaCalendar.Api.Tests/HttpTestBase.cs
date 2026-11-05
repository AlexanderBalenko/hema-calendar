using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace HemaCalendar.Api.Tests;

/// <summary>
/// Основа http-тестов: СВОЯ пустая база на каждый тест.
///
/// xUnit создаёт экземпляр тестового класса на каждый тест, поэтому отдельная база заводится в
/// <see cref="InitializeAsync"/> и сносится после. Так тест не зависит ни от порядка выполнения,
/// ни от того, что накопил сосед, — правило проекта, оплаченное реальными падениями на портале.
/// Цена — около секунды на тест: для двух десятков проверок это дешевле любой хитрой изоляции.
///
/// Требуется поднятый Postgres стенда (docker compose up -d postgres). Если его нет, тесты
/// падают с внятной ошибкой подключения, а не притворяются пройденными.
/// </summary>
public abstract class HttpTestBase : IAsyncLifetime
{
    public const string AdminKey = "test-admin-key";

    private static readonly string AdminConnection =
        Environment.GetEnvironmentVariable("CALENDAR_TEST_DB")
        // Timeout=30: на стенде Postgres живёт в докере рядом с двумя другими проектами и
        // отвечает не мгновенно, а умолчание в 15 секунд тесты уже роняло.
        ?? "Host=localhost;Port=5433;Database=postgres;Username=calendar;Password=calendar;Timeout=30";

    private readonly string _database = $"calendar_test_{Guid.NewGuid():N}";
    private CalendarApp? _app;

    /// <summary>Ключ модератора этого приложения. Пустой — проверка «забытой переменной».</summary>
    protected virtual string ConfiguredAdminKey => AdminKey;

    /// <summary>Лимит заявок в час. По умолчанию снят: его проверяет отдельный класс.</summary>
    protected virtual int SubmissionsPerHour => 1000;

    protected CalendarApp App => _app ?? throw new InvalidOperationException("InitializeAsync ещё не отработал");

    protected HttpClient Client => App.CreateClient();

    protected HttpClient AdminClient(string key = AdminKey)
    {
        var client = App.CreateClient();
        client.DefaultRequestHeaders.Add("X-Calendar-Admin-Key", key);
        return client;
    }

    /// <summary>Прямой доступ к базе для подготовки данных и проверок «что реально сохранилось».</summary>
    protected async Task WithDb(Func<CalendarDb, Task> work)
    {
        using var scope = App.Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<CalendarDb>());
    }

    public async Task InitializeAsync()
    {
        await using (var connection = new NpgsqlConnection(AdminConnection))
        {
            await connection.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{_database}\"", connection);
            await create.ExecuteNonQueryAsync();
        }

        var builder = new NpgsqlConnectionStringBuilder(AdminConnection) { Database = _database };
        _app = new CalendarApp(builder.ConnectionString, ConfiguredAdminKey, SubmissionsPerHour);

        using var scope = _app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<CalendarDb>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();

        await using var connection = new NpgsqlConnection(AdminConnection);
        await connection.OpenAsync();
        // WITH (FORCE) — иначе база не удаляется, пока пул держит соединения приложения.
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_database}\" WITH (FORCE)", connection);
        await drop.ExecuteNonQueryAsync();
    }
}

public sealed class CalendarApp(string connectionString, string adminKey, int submissionsPerHour)
    : WebApplicationFactory<Program>
{
    /// <summary>Разбор ответов — теми же правилами, что и у сервиса (enum строками).</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Default", connectionString);
        builder.UseSetting("Admin:Key", adminKey);
        builder.UseSetting("Submissions:PerHour", submissionsPerHour.ToString());
        builder.UseEnvironment("Testing");
    }
}

public static class HttpExtensions
{
    public static async Task<T> ReadAs<T>(this HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(text, CalendarApp.Json)
               ?? throw new InvalidOperationException($"Пустой ответ: {text}");
    }

    public static Task<HttpResponseMessage> PostJson(this HttpClient client, string url, object body) =>
        client.PostAsJsonAsync(url, body, CalendarApp.Json);
}
