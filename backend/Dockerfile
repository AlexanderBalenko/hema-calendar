FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY HemaCalendar.slnx nuget.config ./
COPY src/ src/
RUN dotnet publish src/HemaCalendar.Api/HemaCalendar.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "HemaCalendar.Api.dll"]
