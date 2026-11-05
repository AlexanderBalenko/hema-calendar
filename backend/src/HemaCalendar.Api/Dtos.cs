namespace HemaCalendar.Api;

/// <summary>
/// Наружные контракты. Публичные DTO — СВОИ, узкие: в них принципиально нет контактов заявителя,
/// внутренних заметок и причины отказа. Публичный эндпоинт не переиспользует доменную сущность
/// именно поэтому — иначе первое же добавленное служебное поле утечёт наружу.
/// </summary>
public record CalendarEventDto(
    Guid Id,
    string Slug,
    string Title,
    DateOnly StartsAt,
    DateOnly EndsAt,
    string? City,
    string? MacroRegion,
    string? CountryCode,
    string? LocationManual,
    string? OrganizerName,
    string? ExternalUrl,
    IReadOnlyList<NominationDto> Nominations);

public record NominationDto(
    string Weapon,
    string? WeaponCode,
    Gender Gender,
    int? MinAge,
    int? MaxAge,
    bool IsTeam,
    bool IsBeginnerFriendly,
    string? Notes);

public record EventDetailsDto(CalendarEventDto Event, string? Description);

public record DirectoriesDto(
    IReadOnlyList<WeaponDto> Weapons,
    IReadOnlyList<CityDto> Cities,
    IReadOnlyList<string> MacroRegions);

public record WeaponDto(int Id, string Name, string Code);

public record CityDto(int Id, string Name, string MacroRegion, string CountryCode);

/// <summary>
/// Заявка на турнир от незнакомца. Website — ловушка для ботов (поле скрыто от человека, бот его
/// заполняет); приём молча делает вид, что всё хорошо, и ничего не сохраняет.
/// </summary>
public record SubmitEventRequest(
    string Title,
    DateOnly StartsAt,
    DateOnly? EndsAt,
    int? CityId,
    string? LocationManual,
    string? OrganizerName,
    string? ExternalUrl,
    string? Description,
    string? Contact,
    string? Note,
    IReadOnlyList<SubmitNominationRequest>? Nominations,
    string? Website);

public record SubmitNominationRequest(
    int? WeaponId,
    string? WeaponText,
    Gender Gender,
    int? MinAge,
    int? MaxAge,
    bool IsTeam,
    bool IsBeginnerFriendly,
    string? Notes);

/// <summary>Очередь модерации: здесь контакты и заметки видны — маршрут закрыт админ-ключом.</summary>
public record ModerationItemDto(
    Guid Id,
    string Title,
    DateOnly StartsAt,
    DateOnly EndsAt,
    string? City,
    string? LocationManual,
    string? OrganizerName,
    string? ExternalUrl,
    string? Description,
    string? SubmitterContact,
    string? SubmitterNote,
    EventSource Source,
    DateTimeOffset CreatedAt,
    IReadOnlyList<NominationDto> Nominations);

public record RejectRequest(string? Reason);
