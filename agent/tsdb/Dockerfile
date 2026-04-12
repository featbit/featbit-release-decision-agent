# ── Build stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore — copy csproj files first for layer caching
COPY src/FeatBit.DataWarehouse/FeatBit.DataWarehouse.csproj src/FeatBit.DataWarehouse/
COPY src/FeatBit.TsdbServer/FeatBit.TsdbServer.csproj      src/FeatBit.TsdbServer/
RUN dotnet restore src/FeatBit.TsdbServer/FeatBit.TsdbServer.csproj

# Build
COPY src/ src/
RUN dotnet publish src/FeatBit.TsdbServer/FeatBit.TsdbServer.csproj -c Release -o /app

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .

RUN mkdir -p /data/tsdb

ENV ASPNETCORE_URLS=http://+:5059
ENV DataRoot=/data/tsdb
EXPOSE 5059

VOLUME ["/data/tsdb"]

ENTRYPOINT ["dotnet", "FeatBit.TsdbServer.dll"]
