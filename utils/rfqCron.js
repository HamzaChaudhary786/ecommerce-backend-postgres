import cron from 'node-cron';
import prisma from '../config/db.js';

// Run every day at midnight (0 0 * * *)
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running RFQ expiry cron job...');
    
    const now = new Date();
    
    // Find published or quotation received RFQs where expiresAt is passed
    const expiredRFQs = await prisma.rFQ.findMany({
      where: {
        status: { in: ['PUBLISHED', 'QUOTATION_RECEIVED'] },
        expiresAt: { lt: now }
      }
    });

    if (expiredRFQs.length > 0) {
      console.log(`Found ${expiredRFQs.length} expired RFQs. Updating status to EXPIRED...`);
      
      for (const rfq of expiredRFQs) {
        // Update RFQ status
        await prisma.rFQ.update({
          where: { id: rfq.id },
          data: { status: 'EXPIRED' }
        });

        // Log Activity
        await prisma.rFQActivityLog.create({
          data: { rfqId: rfq.id, userId: rfq.buyerId, action: 'EXPIRED' }
        });

        // Here we could also send email or in-app notification to the buyer
        console.log(`RFQ ${rfq.rfqNumber} marked as EXPIRED.`);
      }
    }
  } catch (error) {
    console.error('Error in RFQ expiry cron job:', error);
  }
});
