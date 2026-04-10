# ── Runtime base: ASP.NET 10 + Python 3 (for analyze-bayesian.py) ────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl && \
    python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir numpy scipy && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:$PATH"

# ── Build stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY FRD.DataServer.csproj ./
RUN dotnet restore
COPY . .
RUN rm -rf bin obj
RUN dotnet publish -c Release -o /app

# ── Final image ──────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
COPY --from=build /app .
COPY Scripts/ ./Scripts/

ENV ASPNETCORE_URLS=http://+:5058
EXPOSE 5058

ENTRYPOINT ["dotnet", "FRD.DataServer.dll"]
