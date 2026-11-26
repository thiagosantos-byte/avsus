import 'dotenv/config';
import app from './app.js';

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`HealthData Brasil API disponível em http://localhost:${port}`));
