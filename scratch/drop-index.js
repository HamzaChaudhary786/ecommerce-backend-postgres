import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const dropIndex = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not defined in .env');

    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
    
    // Explicitly access the collection and drop the index
    const collection = mongoose.connection.db.collection('reviews');
    
    console.log('Attempting to drop index: listing_1_user_1');
    try {
      await collection.dropIndex('listing_1_user_1');
      console.log('Successfully dropped index listing_1_user_1');
    } catch (e) {
      if (e.code === 27) {
        console.log('Index listing_1_user_1 does not exist, skipping.');
      } else {
        throw e;
      }
    }
    
    // Mongoose will create the new index automatically when the app restarts
    // as it is defined in the Review model.

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
};

dropIndex();
