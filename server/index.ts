import { createApp } from './app.ts';
import { config } from 'dotenv';
config({ quiet: true });
const port = Number(process.env.PORT || 3001);
const server = createApp().listen(port, '127.0.0.1', () => console.log(`Listing Checker API: http://127.0.0.1:${port}`));
for (const event of ['SIGINT','SIGTERM']) process.on(event, () => server.close(() => process.exit(0)));
