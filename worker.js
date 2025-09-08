import Queue from 'bull';
import imageThumbnail from 'image-thumbnail';
import { promises as fs } from 'fs';
import { ObjectId } from 'mongodb';
import dbClient from './utils/db';

// Queue for file thumbnail processing
const fileQueue = new Queue('fileQueue');

fileQueue.process(async (job, done) => {
  try {
    const { fileId, userId } = job.data || {};

    if (!fileId) throw new Error('Missing fileId');
    if (!userId) throw new Error('Missing userId');

    const filesCol = dbClient.filesCollection || (dbClient.db && dbClient.db.collection('files'));
    if (!filesCol) throw new Error('File not found');

    const filter = { _id: new ObjectId(fileId), userId: new ObjectId(userId) };
    const file = await filesCol.findOne(filter);
    if (!file || !file.localPath) throw new Error('File not found');

    // Only generate thumbnails for image type
    if (file.type !== 'image') {
      return done();
    }

    // Generate thumbnails at widths 500, 250, 100
    const widths = [500, 250, 100];
    // Process sequentially to avoid heavy parallel CPU usage
    // If any generation fails, throw to let Bull handle retry policies if configured
    // Store results next to original file with suffix _<width>
    // imageThumbnail returns a Buffer
    for (const width of widths) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await imageThumbnail(file.localPath, { width });
      const thumbPath = `${file.localPath}_${width}`;
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(thumbPath, buffer);
    }

    return done();
  } catch (err) {
    return done(err);
  }
});
