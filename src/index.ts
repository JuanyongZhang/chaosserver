import 'dotenv/config';
import { createApp } from './app';
import { resolvePort } from './config';

// Reads PORT from the environment (or `.env`), falling back to DEFAULT_PORT.
const port = resolvePort(process.env.PORT);

const { app } = createApp();

app.listen(port, () => {
    console.log(`Mock server running at http://localhost:${port}`);
});
