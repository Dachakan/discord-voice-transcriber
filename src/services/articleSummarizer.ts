import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArticleData } from './articleScraper';

export class ArticleSummarizer {
  private genAI: GoogleGenerativeAI;
  
  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }
  
  async summarizeArticle(article: ArticleData): Promise<string> {
    console.log('🤖 記事を要約中...');
    
    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // 記事の内容を整形
    const articleInfo = this.formatArticleInfo(article);
    
    const prompt = `
以下の記事を日本語で要約してください。

【要約のガイドライン】
- 重要なポイントを3-5個の箇条書きで
- 各ポイントは1-2文で簡潔に
- 記事の核心的な内容を優先
- 技術的な内容は正確に
- 専門用語は適切に使用
- 読者が記事の概要を素早く理解できるように

【記事情報】
${articleInfo}

【本文】
${article.content}

【要約】
`;
    
    try {
      const result = await model.generateContent(prompt);
      const summary = result.response.text();
      console.log('✅ 要約生成完了');
      return summary;
    } catch (error) {
      console.error('❌ 要約生成エラー:', error);
      throw error;
    }
  }
  
  // 記事情報を整形
  private formatArticleInfo(article: ArticleData): string {
    const parts: string[] = [];
    
    parts.push(`タイトル: ${article.title}`);
    
    if (article.siteName) {
      parts.push(`サイト: ${article.siteName}`);
    }
    
    if (article.author) {
      parts.push(`著者: ${article.author}`);
    }
    
    if (article.publishedDate) {
      const date = new Date(article.publishedDate);
      const formattedDate = date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      parts.push(`投稿日: ${formattedDate}`);
    }
    
    if (article.description) {
      parts.push(`説明: ${article.description}`);
    }
    
    return parts.join('\n');
  }
  
  // タグを生成（記事の内容から）
  generateTags(article: ArticleData, summary: string): string[] {
    const tags: Set<string> = new Set();
    
    // URLからドメイン名を抽出してタグに
    try {
      const url = new URL(article.url);
      const domain = url.hostname.replace('www.', '').split('.')[0];
      tags.add(domain);
    } catch (e) {
      // URLパースエラーは無視
    }
    
    // 一般的な技術キーワードを検出
    const techKeywords = [
      'AI', '人工知能', '機械学習', 'ディープラーニング', 'ChatGPT', 'GPT',
      'プログラミング', 'JavaScript', 'Python', 'React', 'Vue', 'Node.js',
      'Web開発', 'アプリ開発', 'データベース', 'クラウド', 'AWS', 'Google Cloud',
      'セキュリティ', 'ブロックチェーン', 'IoT', 'AR', 'VR', 'メタバース',
      'スタートアップ', 'ビジネス', 'マーケティング', 'デザイン', 'UI', 'UX'
    ];
    
    const combinedText = `${article.title} ${summary}`.toLowerCase();
    
    techKeywords.forEach(keyword => {
      if (combinedText.includes(keyword.toLowerCase())) {
        tags.add(keyword.replace(/\s+/g, '_'));
      }
    });
    
    // タイトルから主要な単語を抽出（日本語対応）
    const titleWords = article.title
      .split(/[\s、。・]/g)
      .filter(word => word.length > 2 && !word.match(/^(の|を|に|は|が|で|と|から|まで|より)$/));
    
    titleWords.slice(0, 3).forEach(word => {
      if (word.length <= 10) {  // 長すぎるタグは避ける
        tags.add(word);
      }
    });
    
    return Array.from(tags).slice(0, 5);  // 最大5個のタグ
  }
}