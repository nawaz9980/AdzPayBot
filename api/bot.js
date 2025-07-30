const { Telegraf } = require('telegraf');
const pool = require('../db');

const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_IDS = [1913794746]; // replace with your admin Telegram ID
const MIN_WITHDRAW = 50;

// Save user on any interaction
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const { id, username, first_name } = ctx.from;
    await pool.execute(
      'INSERT INTO users (id, username, first_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username=?, first_name=?',
      [id, username, first_name, username, first_name]
    );
  }
  return next();
});

// Admin replies to group user with number to credit
// Admin replies to group user with amount to reward
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const isGroup = chat.type.endsWith('group');

  if (!isGroup || !ctx.message.reply_to_message || !ADMIN_IDS.includes(ctx.from.id)) return;

  const reward = parseFloat(ctx.message.text.trim());
  if (isNaN(reward) || reward <= 0) return;

  const targetUser = ctx.message.reply_to_message.from;

  // Save user if not already in DB
  await pool.execute(
    `INSERT INTO users (id, username, first_name, balance)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       first_name = VALUES(first_name),
       balance = balance + VALUES(balance)`,
    [targetUser.id, targetUser.username, targetUser.first_name, reward]
  );

  await ctx.reply(`✅ Credited $${reward} to ${targetUser.username ? '@' + targetUser.username : targetUser.first_name}`);
});


// /balance command
bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  const [rows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);

  if (rows.length > 0) {
    const balance = rows[0].balance;
    ctx.reply(`💼 Your balance: $${balance}`);
  } else {
    ctx.reply('❌ No account found.');
  }
});

// /withdraw command
bot.command('withdraw', async (ctx) => {
  const userId = ctx.from.id;
  const [rows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);

  if (rows.length === 0) return ctx.reply('❌ No account found.');

  const balance = rows[0].balance;
  if (balance < MIN_WITHDRAW) {
    return ctx.reply(`❌ Minimum withdraw is $${MIN_WITHDRAW}. Your balance is $${balance}`);
  }

  await pool.execute('INSERT INTO withdrawals (user_id, amount) VALUES (?, ?)', [userId, balance]);
  await pool.execute('UPDATE users SET balance = 0 WHERE id = ?', [userId]);

  ctx.reply('✅ Withdrawal request sent. You will be paid soon.');
});

// webhook handler for Vercel
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Bot error');
  }
};
