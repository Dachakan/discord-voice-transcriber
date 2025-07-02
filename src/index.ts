import { Client, GatewayIntentBits, Message, Attachment, PartialMessage, EmbedBuilder, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';
import { IdeaManager } from './services/ideaManager';
import { TranscriptionService } from './services/transcription';
import { ArticleScraper } from './services/articleScraper';
import { ArticleSummarizer } from './services/articleSummarizer';
import { ArxivService } from './services/arxivService';
import { PaperSummarizer } from './services/paperSummarizer';
import { MidjourneyService } from './services/midjourneyService';
import * as path from 'path';
import * as http from 'http';

// 簡単なHTTPサーバーを追加（Render.com用）
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Voice Transcriber Bot is running!');
});

server.listen(PORT, () => {
  console.log(`🚀 Health check server listening on port ${PORT}`);
});

// 環境変数を読み込む
dotenv.config();

// 定数
const OBSIDIAN_VAULT_CHANNEL_NAME = 'obsidian-vault';
const MONITORED_CHANNELS = [
  '執筆アイデア',
  'aiアイデア',
  'プロンプトアイデア',
  'devアイデア',
  'ひらめき',
  'discord-develop',
  'meeting',
  '論文収集',
  'midjourney'  // 追加
];

// 各サービスを初期化
const ideaManager = new IdeaManager();
const transcriptionService = new TranscriptionService();
const articleScraper = new ArticleScraper();
const articleSummarizer = new ArticleSummarizer(process.env.GOOGLE_AI_API_KEY!);
const arxivService = new ArxivService();
const paperSummarizer = new PaperSummarizer(process.env.GOOGLE_AI_API_KEY!);
const midjourneyService = new MidjourneyService();

// 論文検索用の一時保存
let lastPaperSearch: { channelId: string; papers: any[] } | null = null;

// Midjourney用の一時保存
const imagePromptData = new Map<string, any>();

// Discord Clientを初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// 日時フォーマット関数
function formatDateTimeForDisplay(timestamp: string): string {
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(9, 11);
  const minute = timestamp.slice(11, 13);
  const second = timestamp.slice(13, 15);
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// Obsidian Vault チャンネルを取得する関数
async function getObsidianVaultChannel(guild: any) {
  let channel = guild.channels.cache.find((ch: any) => ch.name === OBSIDIAN_VAULT_CHANNEL_NAME);
  
  if (!channel) {
    channel = await guild.channels.create({
      name: OBSIDIAN_VAULT_CHANNEL_NAME,
      type: 0,
      topic: 'Obsidian同期用のMarkdownデータ保管庫'
    });
  }
  
  return channel;
}

// Obsidian形式のMarkdownを生成する関数
function generateObsidianMarkdown(idea: any, additionalInfo?: any): string {
  const timestamp = idea.timestamp || new Date().toISOString();
  const dateTime = timestamp.includes('_') ? formatDateTimeForDisplay(timestamp) : timestamp;
  
  let markdown = `## 🗓️ ${dateTime}\n`;
  markdown += `**📍 チャンネル**: #${idea.channel}\n`;
  markdown += `**👤 投稿者**: ${idea.author}\n`;
  
  switch (idea.type) {
    case 'voice':
      markdown += `**🎙️ タイプ**: 音声メモ`;
      if (idea.metadata?.duration) {
        markdown += ` (${idea.metadata.duration})`;
      }
      markdown += `\n\n### 💭 内容\n${idea.content}\n`;
      break;
      
    case 'article':
      markdown += `**📰 タイプ**: 記事要約\n`;
      if (idea.metadata?.url) {
        markdown += `**🔗 URL**: ${idea.metadata.url}\n`;
      }
      if (idea.metadata?.title) {
        markdown += `**📌 タイトル**: ${idea.metadata.title}\n`;
      }
      markdown += `\n### 📊 要約\n${idea.content}\n`;
      break;
      
    case 'paper':
      markdown += `**📄 タイプ**: 論文要約\n`;
      if (idea.metadata?.title) {
        markdown += `\n### 📑 論文情報\n`;
        markdown += `**タイトル**: ${idea.metadata.title}\n`;
        if (idea.metadata?.authors) {
          markdown += `**著者**: ${idea.metadata.authors}\n`;
        }
        if (idea.metadata?.category) {
          markdown += `**カテゴリ**: ${idea.metadata.category}\n`;
        }
      }
      markdown += `\n### 📊 要約\n${idea.content}\n`;
      
      if (additionalInfo?.detailedSummary) {
        markdown += `\n### 🔍 詳細な要約\n${additionalInfo.detailedSummary}\n`;
      }
      break;
      
    default:
      markdown += `**📝 タイプ**: テキストメモ\n\n### 💭 内容\n${idea.content}\n`;
  }
  
  if (idea.tags && idea.tags.length > 0) {
    markdown += `\n### 🏷️ タグ\n${idea.tags.map((tag: string) => `#${tag}`).join(' ')}\n`;
  }
  
  markdown += `\n---\n*↑このままObsidianにコピペ可能*`;
  
  return markdown;
}

// タイムスタンプ生成関数
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

// Botが起動したとき
client.on('ready', () => {
  console.log(`✅ ${client.user?.tag} が起動しました！`);
  console.log(`📝 監視中のチャンネル: ${MONITORED_CHANNELS.join(', ')}`);
  console.log('🌐 記事自動要約機能: 有効');
  console.log('📚 論文収集機能: 有効');
  console.log('🎨 Midjourney連携機能: 有効');
});

// メッセージを受信したとき
client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  const channelName = (message.channel as TextChannel).name;
  
  // コマンドは全チャンネルで有効
  if (message.content.startsWith('!')) {
    await handleCommand(message);
    return;
  }
  
  // 監視対象チャンネルでのみ自動処理
  if (!MONITORED_CHANNELS.includes(channelName)) return;

  try {
    // 音声ファイルの処理
    if (message.attachments.size > 0) {
      await handleAttachments(message);
      return;
    }

    // URLを含むメッセージの処理
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (urls && urls.length > 0) {
      await handleArticleURL(message, urls[0]);
      return;
    }

    // 通常のテキストメッセージ
    if (message.content.trim()) {
      await handleTextMessage(message);
    }

  } catch (error) {
    console.error('エラー:', error);
    await message.reply('❌ 処理中にエラーが発生しました');
  }
});

// ボタンインタラクションの処理
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  // アスペクト比ボタンの処理
  if (interaction.customId.startsWith('ar_')) {
    const parts = interaction.customId.split('_');
    const aspectRatio = `${parts[1]}:${parts[2]}`;
    const messageId = parts[3];
    
    const data = imagePromptData.get(messageId);
    if (!data || data.userId !== interaction.user.id) {
      return interaction.reply({ 
        content: '❌ このボタンは使用できません', 
        ephemeral: true 
      });
    }
    
    await interaction.deferUpdate();
    
    const prompt = midjourneyService.generatePrompt(data.imageUrl, aspectRatio);
    const embed = midjourneyService.createPromptEmbed(prompt);
    embed.setImage(data.imageUrl);
    
    await interaction.editReply({
      embeds: [embed],
      components: []
    });
    
    // データをクリーンアップ
    imagePromptData.delete(messageId);
  }
});

// コマンド処理
async function handleCommand(message: Message) {
  const command = message.content.slice(1).split(' ')[0].toLowerCase();
  const args = message.content.slice(1).split(' ').slice(1);

  switch (command) {
    case 'test':
    case 'テスト':
      await testGeminiAPI(message);
      break;
    case '論文':
    case 'paper':
      await handlePaperCommand(message, args);
      break;
    case 'wap':
      await handleWapCommand(message);
      break;
    case 'wav':
      await handleWavCommand(message);
      break;
    case 'help':
    case 'ヘルプ':
      await showHelp(message);
      break;
    case 'stats':
    case '統計':
      await showStats(message);
      break;
    case 'list':
    case 'リスト':
      await showRecentIdeas(message, args[0]);
      break;
    default:
      await message.reply('❓ 不明なコマンドです。`!help`でコマンド一覧を確認してください。');
  }
}

// !wap コマンド（画像からMidjourneyプロンプト生成）
async function handleWapCommand(message: Message) {
  const imageAttachment = message.attachments.find(att => 
    att.contentType?.startsWith('image')
  );
  
  if (!imageAttachment) {
    return message.reply('❌ 画像を添付してください。\n使い方: `!wap` と画像を一緒に投稿');
  }

  // アスペクト比選択ボタンを作成
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`ar_16_9_${message.id}`)
        .setLabel('16:9 (横長)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🖼️'),
      new ButtonBuilder()
        .setCustomId(`ar_1_1_${message.id}`)
        .setLabel('1:1 (正方形)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⬜'),
      new ButtonBuilder()
        .setCustomId(`ar_9_16_${message.id}`)
        .setLabel('9:16 (縦長)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📱'),
      new ButtonBuilder()
        .setCustomId(`ar_4_5_${message.id}`)
        .setLabel('4:5 (ポートレート)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🖼️')
    );

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎨 アスペクト比を選択')
    .setDescription('生成する画像のアスペクト比を選んでください')
    .setImage(imageAttachment.url)
    .setFooter({ text: '30秒以内に選択してください' });

  const response = await message.reply({
    embeds: [embed],
    components: [row]
  });

  // 一時的にデータを保存
  imagePromptData.set(message.id, {
    imageUrl: imageAttachment.url,
    userId: message.author.id,
    timestamp: Date.now()
  });
  
  // 30秒後にクリーンアップ
  setTimeout(() => {
    imagePromptData.delete(message.id);
  }, 30000);
}

// !wav コマンド（音声からMidjourneyプロンプト生成）
async function handleWavCommand(message: Message) {
  const audioExtensions = ['.ogg', '.mp3', '.wav', '.m4a'];
  const voiceAttachment = message.attachments.find(att => 
    audioExtensions.some(ext => att.name?.toLowerCase().endsWith(ext))
  );
  
  if (!voiceAttachment) {
    return message.reply('❌ 音声ファイルを添付してください。\n使い方: `!wav` と音声ファイルを一緒に投稿');
  }

  const processingEmbed = new EmbedBuilder()
    .setColor(0xFFFF00)
    .setTitle('🎙️ 処理中...')
    .setDescription('音声を文字起こししています...');
  
  const processingMsg = await message.reply({ embeds: [processingEmbed] });
  
  try {
    // 音声を文字起こし
    const transcription = await transcriptionService.transcribeAudio(
      voiceAttachment.url,  // URLを直接渡す
      voiceAttachment.name || 'audio'
    );
    
    // プログレス更新
    processingEmbed
      .setDescription('✅ 文字起こし完了\n📝 英語プロンプトを生成中...')
      .addFields({
        name: '文字起こし内容',
        value: transcription.length > 200 
          ? transcription.substring(0, 200) + '...' 
          : transcription
      });
    await processingMsg.edit({ embeds: [processingEmbed] });
    
    // 英語プロンプトを生成
    const creativePrompt = await midjourneyService.generateCreativePrompt(transcription);
    
    // Midjourneyプロンプトを構築
    const fullPrompt = midjourneyService.generateTextPrompt(creativePrompt);
    
    // 結果を表示
    const resultEmbed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ 音声からプロンプト生成完了')
      .addFields(
        {
          name: '🎙️ 文字起こし内容',
          value: transcription.length > 300 
            ? transcription.substring(0, 300) + '...' 
            : transcription
        },
        {
          name: '🎨 生成された英語プロンプト',
          value: creativePrompt
        },
        {
          name: '📋 Midjourneyプロンプト（コピー用）',
          value: `\`\`\`${fullPrompt}\`\`\``
        }
      )
      .setFooter({ text: 'プロンプトをコピーしてMidjourneyで使用してください' });
    
    await processingMsg.edit({ embeds: [resultEmbed] });
    
  } catch (error) {
    console.error('音声処理エラー:', error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ エラー')
      .setDescription('音声の処理中にエラーが発生しました。');
    await processingMsg.edit({ embeds: [errorEmbed] });
  }
}

// 音声ファイル処理
async function handleAttachments(message: Message) {
  const audioExtensions = ['.ogg', '.mp3', '.wav', '.m4a'];
  
  for (const attachment of message.attachments.values()) {
    const isAudio = audioExtensions.some(ext => attachment.name?.toLowerCase().endsWith(ext));
    
    if (isAudio) {
      const reply = await message.reply('🎙️ 音声を文字起こし中...');
      
      try {
        const transcription = await transcriptionService.transcribeAudio(
          attachment.url,  // URLを直接渡す
          attachment.name || 'audio'
        );
        
        const timestamp = generateTimestamp();
        const idea = {
          timestamp,
          content: transcription,
          type: 'voice',
          author: message.author.username,
          channel: (message.channel as TextChannel).name,
          tags: [],
          metadata: { 
            fileName: attachment.name,
            duration: attachment.size ? `${Math.round(attachment.size / 1000)}KB` : undefined
          }
        };
        
        // Obsidian Vault チャンネルに投稿
        const vaultChannel = await getObsidianVaultChannel(message.guild!);
        const obsidianMarkdown = generateObsidianMarkdown(idea);
        await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
        
        await reply.edit(`✅ 音声の文字起こしが完了しました！\n📅 タイムスタンプ: ${formatDateTimeForDisplay(timestamp)}`);
        
      } catch (error) {
        console.error('音声処理エラー:', error);
        await reply.edit('❌ 音声の文字起こしに失敗しました');
      }
    }
  }
}

// 記事URL処理
async function handleArticleURL(message: Message, url: string) {
  const processingMsg = await message.reply('📰 記事を取得中...');
  
  try {
    const article = await articleScraper.scrapeArticle(url);
    const summary = await articleSummarizer.summarizeArticle(article);
    
    const timestamp = generateTimestamp();
    const idea = {
      timestamp,
      content: summary,
      type: 'article',
      author: message.author.username,
      channel: (message.channel as TextChannel).name,
      tags: [],
      metadata: {
        url: url,
        title: article.title,
        author: article.author,
        publishedDate: article.publishedDate
      }
    };
    
    // Obsidian Vault チャンネルに投稿
    const vaultChannel = await getObsidianVaultChannel(message.guild!);
    const obsidianMarkdown = generateObsidianMarkdown(idea);
    await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
    
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle(article.title || '記事')
      .setURL(url)
      .setDescription(summary)
      .setFooter({ text: `保存済み | タイムスタンプ: ${formatDateTimeForDisplay(timestamp)}` });
    
    await processingMsg.edit({ content: '✅ 記事を要約しました！', embeds: [embed] });
    
  } catch (error) {
    console.error('記事処理エラー:', error);
    await processingMsg.edit('❌ 記事の取得または要約に失敗しました');
  }
}

// テキストメッセージ処理
async function handleTextMessage(message: Message) {
  const timestamp = generateTimestamp();
  const idea = {
    timestamp,
    content: message.content,
    type: 'text',
    author: message.author.username,
    channel: (message.channel as TextChannel).name,
    tags: []
  };
  
  // Obsidian Vault チャンネルに投稿
  const vaultChannel = await getObsidianVaultChannel(message.guild!);
  const obsidianMarkdown = generateObsidianMarkdown(idea);
  await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
  
  await message.reply(`💡 アイデアを保存しました！\n📅 タイムスタンプ: ${formatDateTimeForDisplay(timestamp)}`);
}

// 論文コマンド処理
async function handlePaperCommand(message: Message, args: string[]) {
  if (args.length === 0) {
    await showPaperMenu(message);
  } else if (args[0] === 'select') {
    await selectPapers(message, args.slice(1));
  } else {
    const query = args.join(' ');
    await searchPapers(message, query);
  }
}

// 論文メニュー表示
async function showPaperMenu(message: Message) {
  const embed = new EmbedBuilder()
    .setColor(0x00AE86)
    .setTitle('📚 論文検索メニュー')
    .setDescription('検索したいカテゴリーの番号を入力してください')
    .addFields(
      { name: '1. AI・機械学習', value: '最新のAI・ML研究', inline: true },
      { name: '2. 自然言語処理', value: 'NLP・言語モデル', inline: true },
      { name: '3. コンピュータビジョン', value: '画像認識・生成', inline: true },
      { name: '4. ロボティクス', value: 'ロボット工学', inline: true },
      { name: '5. 量子コンピュータ', value: '量子計算・量子情報', inline: true },
      { name: '6. 医療・ヘルスケアAI', value: '医療AI応用', inline: true },
      { name: '7. 建設・建築技術', value: '建設技術・BIM', inline: true },
      { name: '8. 自動運転', value: '自動運転技術', inline: true },
      { name: '9. セキュリティ・暗号', value: '情報セキュリティ', inline: true }
    )
    .addFields({
      name: '💡 使い方',
      value: '`!論文 1` のように番号を入力\n`!論文 AIロボット` のように自由検索も可能'
    });
  
  await message.reply({ embeds: [embed] });
}

// 論文検索
async function searchPapers(message: Message, query: string) {
  const searchingMsg = await message.reply('🔍 論文を検索中...');
  
  try {
    const papers = await arxivService.searchPapers(query);
    
    if (papers.length === 0) {
      await searchingMsg.edit('📭 該当する論文が見つかりませんでした');
      return;
    }
    
    lastPaperSearch = {
      channelId: message.channel.id,
      papers: papers
    };
    
    let response = '📚 **論文検索結果**\n\n';
    papers.slice(0, 10).forEach((paper, index) => {
      response += `**${index + 1}.** ${paper.title}\n`;
      response += `   著者: ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' 他' : ''}\n`;
      response += `   公開日: ${paper.published}\n\n`;
    });
    
    response += '\n📌 論文を選択: `!paper select 1,3,5` または `!paper select 1-3`';
    
    await searchingMsg.edit(response);
    
  } catch (error) {
    console.error('論文検索エラー:', error);
    await searchingMsg.edit('❌ 論文の検索に失敗しました');
  }
}

// 論文選択処理
async function selectPapers(message: Message, args: string[]) {
  if (!lastPaperSearch || lastPaperSearch.channelId !== message.channel.id) {
    await message.reply('❌ 先に論文を検索してください');
    return;
  }
  
  // ここでlastPaperSearchは確実に存在する
  const papers = lastPaperSearch.papers;
  
  const processingMsg = await message.reply('📝 論文を処理中...');
  const selectedIndices: number[] = [];
  
  // インデックスのパース
  for (const arg of args) {
    if (arg.includes('-')) {
      const [start, end] = arg.split('-').map(n => parseInt(n) - 1);
      for (let i = start; i <= end && i < papers.length; i++) {
        selectedIndices.push(i);
      }
    } else if (arg.includes(',')) {
      arg.split(',').forEach(n => {
        const index = parseInt(n) - 1;
        if (index >= 0 && index < papers.length) {
          selectedIndices.push(index);
        }
      });
    } else {
      const index = parseInt(arg) - 1;
      if (index >= 0 && index < papers.length) {
        selectedIndices.push(index);
      }
    }
  }
  
  if (selectedIndices.length === 0) {
    await processingMsg.edit('❌ 有効な番号を指定してください');
    return;
  }
  
  // 論文を処理
  const results = [];
  const vaultChannel = await getObsidianVaultChannel(message.guild!);
  
  for (const index of selectedIndices) {
    try {
      const paper = papers[index];
      const summary = await paperSummarizer.summarizePaper(paper);
      
      const timestamp = generateTimestamp();
      const idea = {
        timestamp,
        content: summary.summary,
        type: 'paper',
        author: message.author.username,
        channel: (message.channel as TextChannel).name,
        tags: summary.tags || [],
        metadata: {
          title: paper.title,
          authors: paper.authors.join(', '),
          category: paper.categories.join(', '),
          arxivId: paper.id,
          url: paper.link,
          abstract: paper.summary
        }
      };
      
      // detailedSummaryが存在する場合のみ追加
      const additionalInfo = summary.keyFindings ? {
        detailedSummary: `**重要な発見:**\n${summary.keyFindings.join('\n')}\n\n**応用可能性:**\n${summary.applications}`
      } : undefined;
      
      const obsidianMarkdown = generateObsidianMarkdown(idea, additionalInfo);
      await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
      
      results.push({
        success: true,
        timestamp: timestamp,
        title: paper.title.substring(0, 50) + '...'
      });
      
    } catch (error) {
      console.error(`論文処理エラー:`, error);
      results.push({ success: false });
    }
  }
  
  // 結果を表示
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  let resultMsg = `📊 **論文処理完了**\n✅ 成功: ${successCount}件 ❌ 失敗: ${failCount}件\n\n`;
  
  if (successCount > 0) {
    resultMsg += '**📚 保存された論文**\n';
    results.filter(r => r.success).forEach(r => {
      resultMsg += `**${formatDateTimeForDisplay(r.timestamp!)}** ${r.title}\n`;
    });
  }
  
  resultMsg += '\n✅ Obsidian Vaultチャンネルに保存されました';
  
  await processingMsg.edit(resultMsg);
}

// Gemini APIテスト
async function testGeminiAPI(message: Message) {
  try {
    const testPrompt = "こんにちは！テストです。";
    const response = await articleSummarizer.summarizeArticle({ 
      content: testPrompt, 
      title: 'Test',
      url: '',
      author: '',
      publishedDate: ''
    });
    await message.reply(`✅ Gemini API テスト成功: ${response}`);
  } catch (error) {
    console.error('Gemini APIテストエラー:', error);
    await message.reply('❌ Gemini API テスト失敗');
  }
}

// ヘルプ表示
async function showHelp(message: Message) {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('📖 ヘルプ')
    .setDescription('Voice Transcriber Botの使い方')
    .addFields(
      { name: '🎙️ 音声メモ', value: '音声ファイルを投稿すると自動で文字起こし' },
      { name: '💡 テキストメモ', value: '監視対象チャンネルに投稿すると自動保存' },
      { name: '📰 記事要約', value: 'URLを含むメッセージを投稿すると自動要約' },
      { name: '📚 論文検索', value: '`!論文` でメニュー表示\n`!論文 [検索語]` で検索' },
      { name: '🖼️ Midjourney (画像)', value: '`!wap` と画像を投稿してプロンプト生成' },
      { name: '🎙️ Midjourney (音声)', value: '`!wav` と音声を投稿してプロンプト生成' },
      { name: '📊 統計', value: '`!stats` で保存状況を確認' },
      { name: '📋 一覧', value: '`!list` で最近のアイデア一覧' },
      { name: '🧪 テスト', value: '`!test` でAPI動作確認' }
    )
    .addFields({
      name: '📁 保存先',
      value: '#obsidian-vault チャンネルに自動投稿'
    })
    .addFields({
      name: '💡 Midjourneyコマンドについて',
      value: '`!wap`と`!wav`は全チャンネルで使用可能です'
    });
  
  await message.reply({ embeds: [embed] });
}

// 統計表示
async function showStats(message: Message) {
  const stats = ideaManager.getStats();
  const embed = new EmbedBuilder()
    .setColor(0x00D166)
    .setTitle('📊 統計情報')
    .addFields(
      { name: '💡 総アイデア数', value: stats.total.toString(), inline: true },
      { name: '🎙️ 音声メモ', value: stats.voice.toString(), inline: true },
      { name: '📝 テキスト', value: stats.text.toString(), inline: true },
      { name: '📰 記事', value: stats.article.toString(), inline: true },
      { name: '📚 論文', value: stats.paper.toString(), inline: true }
    );
  
  await message.reply({ embeds: [embed] });
}

// 最近のアイデア表示
async function showRecentIdeas(message: Message, channelFilter?: string) {
  const ideas = ideaManager.getRecentIdeas(10, channelFilter);
  
  if (ideas.length === 0) {
    await message.reply('📭 アイデアがまだありません');
    return;
  }
  
  let response = '📋 **最近のアイデア**\n\n';
  ideas.forEach((idea: any) => {
    const icon = idea.type === 'voice' ? '🎙️' : 
                 idea.type === 'article' ? '📰' : 
                 idea.type === 'paper' ? '📚' : '💡';
    const timestamp = idea.timestamp || 'unknown';
    const author = idea.author || 'unknown';
    const channel = idea.channel || 'unknown';
    const content = idea.content || '';
    
    response += `${icon} **${timestamp}** - ${author} in #${channel}\n`;
    response += `   ${content.substring(0, 50)}...\n\n`;
  });
  
  await message.reply(response);
}

// 古いデータのクリーンアップ（30分ごと）
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30分
  
  for (const [key, value] of imagePromptData.entries()) {
    if (now - value.timestamp > timeout) {
      imagePromptData.delete(key);
    }
  }
}, 30 * 60 * 1000);

// Botをログイン
client.login(process.env.DISCORD_TOKEN);