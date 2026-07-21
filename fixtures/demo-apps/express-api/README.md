# NightVision Express API Fixture

Small local REST API used to demo and test the NightVision MCP guided app security scan harness.

Run it from this directory:

```bash
npm install
npm run dev
```

The app listens on `http://127.0.0.1:9000` and exposes:

- `GET /health`
- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/search`
- `POST /api/login`

Use the MCP harness against this fixture:

```json
{
  "project_path": "/absolute/path/to/nightvision-mcp/fixtures/demo-apps/express-api",
  "target_url": "http://127.0.0.1:9000",
  "nightvision_project": "Demo Project",
  "no_auth": true,
  "wait": false
}
```
