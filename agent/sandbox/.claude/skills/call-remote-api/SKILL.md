# call-remote-api

Call an external REST API and return the parsed response.

## When to use
Use this skill when the user asks to fetch data from an external service,
webhook, or HTTP endpoint.

## Steps

1. Identify the target URL and HTTP method from the user's request.

2. Run the request via the helper script:
   ```bash
   tsx scripts/call-api.ts <METHOD> <URL> [body-json]
   ```
   Examples:
   ```bash
   tsx scripts/call-api.ts GET https://api.example.com/items
   tsx scripts/call-api.ts POST https://api.example.com/items '{"name":"test"}'
   ```

3. The script prints the HTTP status and response body as JSON.
   Summarise the result for the user.

## Authentication
- API keys are read from environment variables by the script.
- Ensure the relevant variable (e.g. `API_KEY`) is set in `.env` before
  invoking this skill.
- Never print raw credentials in your response.

## Error handling
- If the request fails (non-2xx), report the status code and error message.
- Suggest checking the URL, credentials, and network connectivity.
