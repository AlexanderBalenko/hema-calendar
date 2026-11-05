namespace HemaCalendar.Api;

/// <summary>
/// Доменная модель сервиса — намеренно крошечная (решение заказчика 05.11.2026: отдельный
/// компактный репозиторий, «чисто просмотр и фильтрация»).
///
/// Чего здесь НЕТ и не будет без отдельного решения: пользователей, клубов, результатов турниров,
/// медалей, подписок и личных отметок. Календарь не знает, кто его читает, и не хранит ничьих
/// профилей — это и есть причина, по которой его можно выставить отдельным доменом.
/// </summary>
public class CalendarEvent
{
    public Guid Id { get; set; }

    /// <summary>Человекочитаемый адрес события: /events/{slug}. Уникален.</summary>
    public required string Slug { get; set; }

    public required string Title { get; set; }

    public string? Description { get; set; }

    /// <summary>Даты без времени — DateOnly сквозняком (в БД date, на проводе YYYY-MM-DD).</summary>
    public required DateOnly StartsAt { get; set; }

    public required DateOnly EndsAt { get; set; }

    public int? CityId { get; set; }
    public City? City { get; set; }

    /// <summary>Место словами, когда города справочника не хватает: «т/б Рубин (Лен. обл.)».</summary>
    public string? LocationManual { get; set; }

    /// <summary>
    /// Организатор — СТРОКОЙ, а не ссылкой на клуб. В портале событие принадлежит клубу, и это
    /// главное, что здесь отрезано: подать турнир может кто угодно, клуба у него может не быть
    /// вовсе, а у исторических импортов организатор часто неизвестен.
    /// </summary>
    public string? OrganizerName { get; set; }

    /// <summary>Ссылка организатора: сообщество, сайт, страница регистрации.</summary>
    public string? ExternalUrl { get; set; }

    /// <summary>Откуда событие приехало: hemagon, таблица организаторов, заявка с сайта.</summary>
    public EventSource Source { get; set; }

    /// <summary>Ключ записи в источнике — по нему повторный импорт узнаёт своё и не плодит дубли.</summary>
    public string? SourceKey { get; set; }

    public ModerationStatus Status { get; set; }

    /// <summary>Контакт подавшего — только для модератора, наружу не отдаётся никогда.</summary>
    public string? SubmitterContact { get; set; }

    /// <summary>Комментарий подавшего модератору — тоже внутренний.</summary>
    public string? SubmitterNote { get; set; }

    /// <summary>Причина отказа: модератор пишет её себе, а не заявителю (почты у нас нет).</summary>
    public string? RejectionReason { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }

    public List<Nomination> Nominations { get; set; } = [];
}

/// <summary>Номинация турнира: оружие плюс рамки участников. Без результатов — их сервис не хранит.</summary>
public class Nomination
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public CalendarEvent? Event { get; set; }

    public int? WeaponId { get; set; }
    public Weapon? Weapon { get; set; }

    /// <summary>Оружие словами, если его нет в справочнике: источник пишет что угодно.</summary>
    public string? WeaponText { get; set; }

    public Gender Gender { get; set; }
    public int? MinAge { get; set; }
    public int? MaxAge { get; set; }
    public bool IsTeam { get; set; }
    public bool IsBeginnerFriendly { get; set; }
    public string? Notes { get; set; }
    public int SortOrder { get; set; }
}

public class City
{
    public int Id { get; set; }
    public required string Name { get; set; }
    /// <summary>Макрорегион для фильтра: «Европейская часть», «Урал и Зауралье», «Сибирь»…</summary>
    public required string MacroRegion { get; set; }
    /// <summary>Страна кодом ISO: события вне РФ фильтруются отдельно, а не прячутся.</summary>
    public string CountryCode { get; set; } = "RU";
}

public class Weapon
{
    public int Id { get; set; }
    public required string Name { get; set; }
    /// <summary>Латинский код для адресов фильтра: longsword, saber, rapier…</summary>
    public required string Code { get; set; }
    public int SortOrder { get; set; }
}

public enum EventSource
{
    /// <summary>Заявка с сайта от человека.</summary>
    Submission = 0,
    Hemagon = 1,
    /// <summary>Таблица организаторов (Google-таблица, присланный график).</summary>
    Spreadsheet = 2,
}

public enum ModerationStatus
{
    Pending = 0,
    Approved = 1,
    Rejected = 2,
}

public enum Gender
{
    Any = 0,
    Male = 1,
    Female = 2,
}
