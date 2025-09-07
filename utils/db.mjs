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
    // Start connection (non-blocking)
    this.client.connect();
    // Reference DB handle (works after connect is established)
    this.db = this.client.db(this.databaseName);
  }

  isAlive() {
    return this.client.isConnected();
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
