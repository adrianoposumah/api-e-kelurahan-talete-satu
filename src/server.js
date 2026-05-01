import dotenv from 'dotenv';

dotenv.config();
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile, override: true });

import app from './app.js';

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV})`);
});
