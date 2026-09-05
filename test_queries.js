
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function test() {
  const user = await prisma.user.findFirst({ where: { role: 'buyer' } });
  if (!user) return console.log('No buyer found');

  try {
    const orders = await prisma.order.findMany({
      where: { buyerId: user.id }, include: {
        items: { include: { seller: { select: { username: true, avatar: true } }, listing: { select: { id: true, title: true, images: true } } } },
      },
      orderBy: { createdAt: 'desc' }, skip: 0, take: 10,
    });
    console.log('Orders OK');
  } catch (e) { console.error('Orders Error:', e.message); }

  try {
    const watchlist = await prisma.user.findUnique({
      where: { id: user.id },
      select: { watchlist: true },
    });
    const listings = watchlist && watchlist.watchlist && watchlist.watchlist.length > 0
      ? await prisma.listing.findMany({
        where: { id: { in: watchlist.watchlist } },
        select: {
          id: true, title: true, price: true, currentBid: true, startingBid: true,
          images: true, status: true, listingType: true, auctionEndTime: true,
          seller: { select: { username: true } },
        },
      })
      : [];
    console.log('Watchlist OK');
  } catch (e) { console.error('Watchlist Error:', e.message); }

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
    console.log('Conversations OK');
  } catch (e) { console.error('Conversations Error:', e.message); }

  process.exit(0);
}
test();

