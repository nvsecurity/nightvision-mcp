import express from 'express';

const app = express();
const port = Number(process.env.PORT || 9000);

app.use(express.json());

const users = [
  { id: 1, email: 'ada@example.com', role: 'admin' },
  { id: 2, email: 'grace@example.com', role: 'developer' }
];

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/users', (_req, res) => {
  res.json({ users });
});

app.get('/api/users/:id', (req, res) => {
  const user = users.find((item) => item.id === Number(req.params.id));
  if (!user) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(user);
});

app.post('/api/search', (req, res) => {
  res.json({
    query: req.body?.query || '',
    results: users
  });
});

app.post('/api/login', (req, res) => {
  if (req.body?.email && req.body?.password) {
    res.json({ token: 'demo-token', expires_in: 3600 });
    return;
  }
  res.status(400).json({ error: 'email and password are required' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`NightVision Express API fixture listening on http://127.0.0.1:${port}`);
});
