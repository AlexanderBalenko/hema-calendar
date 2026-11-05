using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api;

/// <summary>Адрес события: транслитерация названия плюс дата. Общий для приёма заявок и
/// импорта — иначе один и тот же турнир получал бы разные адреса в зависимости от пути.</summary>
public static class SlugTools
{
    public static async Task<string> UniqueAsync(CalendarDb db, string title, DateOnly start)
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
}
