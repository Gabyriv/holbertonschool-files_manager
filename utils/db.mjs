// utils/db.mjs

import { MongoClient } from 'mongodb';

class DBClient {
  constructor() {
    // Build MongoDB connection URL from env with sane defaults
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || 27017;
    this.databaseName = process.env.DB_DATABASE || 'files_manager';

    const url = `mongodb://${host}:${port}`;

    this.client = new MongoClient(url, { useUnifiedTopology: true });
    // Track connection state; will be set true after a successful ping
    this.connected = false;

    // Start connection (non-blocking), set DB handle and perform a ping
    this.client
      .connect()
      .then(async () => {
        this.db = this.client.db(this.databaseName);
        try {
          // Send a ping to confirm a successful connection
          await this.client.db('admin').command({ ping: 1 });
          this.connected = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('MongoDB ping failed:', err);
          this.connected = false;
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('MongoDB connection error:', err);
        this.connected = false;
      });
  }

  isAlive() {
    return this.connected === true;
  }

  async nbUsers() {
    // Return number of documents in 'users' collection
    return this.db.collection('users').countDocuments();
  }

  async nbFiles() {
    // Return number of documents in 'files' collection
    return this.db.collection('files').countDocuments();
  }
}

const dbClient = new DBClient();
export default dbClient;
