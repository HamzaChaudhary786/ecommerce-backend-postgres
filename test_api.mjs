
import * as dotenv from 'dotenv';
import fs from 'fs';
const envConfig = dotenv.parse(fs.readFileSync('.env'))
for (const k in envConfig) { process.env[k] = envConfig[k]; }

import prisma from './config/db.js';

async function run() {
  const user = await prisma.user.findFirst({ where: { role: 'buyer' } });
  console.log('Testing with buyer:', user.email);
  
  try {
    const watchlistUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { watchlist: true },
    });
    console.log('Watchlist type:', typeof watchlistUser.watchlist, Array.isArray(watchlistUser.watchlist));
    const listings = watchlistUser.watchlist.length > 0
      ? await prisma.listing.findMany({
          where: { id: { in: watchlistUser.watchlist } },
          select: {
            id: true, title: true, price: true, currentBid: true, startingBid: true,
            images: true, status: true, listingType: true, auctionEndTime: true,
            seller: { select: { username: true } },
          },
        })
      : [];
    console.log('Watchlist success');
  } catch(e) {
    console.log('Watchlist failed:', e.message);
  }

  try {
    const orders = await prisma.order.findMany({
      where: { buyerId: user.id }, include: {
        items: { include: { seller: { select: { username: true, avatar: true } }, listing: { select: { id: true, title: true, images: true } } } },
      },
      orderBy: { createdAt: 'desc' }, skip: 0, take: 20,
    });
    console.log('Orders success');
  } catch(e) {
    console.log('Orders failed:', e.message);
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where: { isArchived: false, participants: { some: { userId: user.id } } },
      include: {
        participants: { include: { user: { select: { id: true, name: true, firstName: true, lastName: true, avatar: true, email: true, role: true, username: true } } } },
        listing: { select: { title: true, images: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true, firstName: true, lastName: true } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    console.log('Conversations success');
  } catch(e) {
    console.log('Conversations failed:', e.message);
  }

  process.exit(0);
}
run();

