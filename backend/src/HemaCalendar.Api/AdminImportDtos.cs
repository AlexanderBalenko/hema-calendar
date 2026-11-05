namespace HemaCalendar.Api;

/// <summary>
/// Контракты импорта. Импорт ходит тем же ключом модератора, что и очередь: отдельного «ключа
/// робота» нет намеренно — две двери охранять вдвое дороже, а пускают они в одно и то же.
/// </summary>
public record UpsertDirectoriesRequest(
    IReadOnlyList<UpsertCityRequest> Cities,
    IReadOnlyList<UpsertWeaponRequest> Weapons);

public record UpsertCityRequest(string Name, string MacroRegion, string? CountryCode);

public record UpsertWeaponRequest(string Name, string Code, int SortOrder);

/// <summary>
/// Турнир из внешнего источника. Повторный прогон узнаёт своё по паре Source + SourceKey и
/// обновляет запись, а не плодит вторую: на этом портал уже обжёгся, когда один турнир приехал
/// из двух источников под разными названиями.
/// </summary>
public record ImportEventRequest(
    EventSource Source,
    string SourceKey,
    string Title,
    DateOnly StartsAt,
    DateOnly? EndsAt,
    string? CityName,
    string? LocationManual,
    string? OrganizerName,
    string? ExternalUrl,
    string? Description,
    IReadOnlyList<ImportNominationRequest>? Nominations);

public record ImportNominationRequest(
    string? WeaponCode,
    string? WeaponText,
    Gender Gender,
    int? MinAge,
    int? MaxAge,
    bool IsTeam,
    bool IsBeginnerFriendly,
    string? Notes);

public record ImportResultDto(int Created, int Updated, int Skipped, IReadOnlyList<string> Warnings);
