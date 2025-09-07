// utils/redis.mjs

import redis from "redis";
import { promisify } from "util";

class RedisClient {
  constructor() {
    this.client = redis.createClient();
    this.client.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
    this.client.on("end", () => {
      console.log("Redis connection closed");
    });

    this.getAsync = promisify(this.client.get).bind(this.client);
    this.setexAsync = promisify(this.client.setex).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);
  }

  isAlive() {
    return this.client.connected;
  }

  async get(key) {
    try {
      const value = await this.getAsync(key);
      return value;
    } catch (err) {
      console.error("Redis GET error:", err);
      return null;
    }
  }

  async set(key, value, duration) {
    // Use SETEX to set value with expiration in seconds
    try {
      await this.setexAsync(key, duration, value);
      return true;
    } catch (err) {
      console.error("Redis SETEX error:", err);
      return false;
    }
  }

  async del(key) {
    try {
      await this.delAsync(key);
      return true;
    } catch (err) {
      console.error("Redis DEL error:", err);
      return false;
    }
  }
}

const redisClient = new RedisClient();
export default redisClient;
