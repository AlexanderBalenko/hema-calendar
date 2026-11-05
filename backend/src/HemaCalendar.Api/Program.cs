using System.Threading.RateLimiting;
using HemaCalendar.Api;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Перечисления на проводе — СТРОКАМИ («Any», «Male»), а не числами: номер в JSON читается как
// магическая константа и ломается при любой вставке нового значения в середину enum.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));

builder.Services.AddDbContext<CalendarDb>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// Фронт живёт на своём домене (calendar.hema.ru), API — на своём, поэтому CORS обязателен.
// Список origin'ов задаётся окружением: звёздочка тут была бы приглашением встроить наш календарь
// в чужую страницу и собирать с него трафик под своим именем.
var allowedOrigins = builder.Configuration["Cors:Origins"]?.Split(',', StringSplitOptions.RemoveEmptyEntries)
    ?? ["http://localhost:3000"];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

// Приём заявок — единственный путь записи для анонима, и он должен быть медленным: пять заявок
// в час с адреса. Чтение не ограничиваем: это обычный публичный сайт.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("submit", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromHours(1) }));
});

var app = builder.Build();

// Схему накатывает человек (dotnet ef database update) — приложение миграции не применяет:
// автоприменение на старте означает, что любой перезапуск контейнера меняет прод-схему.
app.UseCors();
app.UseRateLimiter();
app.MapCalendar();

app.Run();

/// <summary>Нужен тестам: WebApplicationFactory требует видимый тип входа.</summary>
public partial class Program;
