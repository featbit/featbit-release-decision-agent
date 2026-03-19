using Npgsql;

namespace Data.Postgres;

public sealed class PostgresConnectionFactory
{
    public NpgsqlConnection Create(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("A PostgreSQL connection string is required.");
        }

        return new NpgsqlConnection(connectionString);
    }
}
