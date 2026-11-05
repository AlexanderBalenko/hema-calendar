using Microsoft.EntityFrameworkCore;

namespace HemaCalendar.Api;

/// <summary>
/// Контекст базы календаря. Схема живёт миграциями EF (как в портале): накатывает их человек,
/// приложение само базу не правит — иначе первый же запуск на проде тихо поменяет схему.
/// </summary>
public class CalendarDb(DbContextOptions<CalendarDb> options) : DbContext(options)
{
    public DbSet<CalendarEvent> Events => Set<CalendarEvent>();
    public DbSet<Nomination> Nominations => Set<Nomination>();
    public DbSet<City> Cities => Set<City>();
    public DbSet<Weapon> Weapons => Set<Weapon>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CalendarEvent>(e =>
        {
            e.ToTable("events");
            e.HasIndex(x => x.Slug).IsUnique();
            // Поиск всегда идёт по окну дат и статусу — один составной индекс закрывает и список,
            // и очередь модерации.
            e.HasIndex(x => new { x.Status, x.StartsAt });
            // Повторный импорт узнаёт своё по паре «источник + ключ»: уникальность не даёт завести
            // один турнир дважды, даже если название в источнике переписали.
            e.HasIndex(x => new { x.Source, x.SourceKey })
                .IsUnique()
                .HasFilter("\"SourceKey\" IS NOT NULL");
            e.Property(x => x.Slug).HasMaxLength(160);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(4000);
            e.Property(x => x.LocationManual).HasMaxLength(256);
            e.Property(x => x.OrganizerName).HasMaxLength(200);
            e.Property(x => x.ExternalUrl).HasMaxLength(512);
            e.Property(x => x.SourceKey).HasMaxLength(200);
            e.Property(x => x.SubmitterContact).HasMaxLength(200);
            e.Property(x => x.SubmitterNote).HasMaxLength(2000);
            e.Property(x => x.RejectionReason).HasMaxLength(500);
            e.HasMany(x => x.Nominations).WithOne(n => n.Event!).HasForeignKey(n => n.EventId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.City).WithMany().HasForeignKey(x => x.CityId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Nomination>(n =>
        {
            n.ToTable("nominations");
            n.Property(x => x.WeaponText).HasMaxLength(120);
            n.Property(x => x.Notes).HasMaxLength(500);
            n.HasOne(x => x.Weapon).WithMany().HasForeignKey(x => x.WeaponId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<City>(c =>
        {
            c.ToTable("cities");
            c.HasIndex(x => x.Name).IsUnique();
            c.Property(x => x.Name).HasMaxLength(120);
            c.Property(x => x.MacroRegion).HasMaxLength(60);
            c.Property(x => x.CountryCode).HasMaxLength(2);
        });

        b.Entity<Weapon>(w =>
        {
            w.ToTable("weapons");
            w.HasIndex(x => x.Code).IsUnique();
            w.Property(x => x.Name).HasMaxLength(80);
            w.Property(x => x.Code).HasMaxLength(40);
        });
    }
}
