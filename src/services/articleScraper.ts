import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ArticleData {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  author?: string;
  siteName?: string;
  ogImage?: string;
  description?: string;
}

export class ArticleScraper {
  // URLから記事を取得
  async scrapeArticle(url: string): Promise<ArticleData> {
    try {
      console.log(`🌐 記事を取得中: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        },
        timeout: 10000, // 10秒のタイムアウト
      });
      
      const $ = cheerio.load(response.data);
      
      // メタデータの取得
      const title = this.extractTitle($);
      const content = this.extractContent($);
      const publishedDate = this.extractDate($);
      const author = this.extractAuthor($);
      const siteName = this.extractSiteName($);
      const ogImage = this.extractOgImage($);
      const description = this.extractDescription($);
      
      console.log(`✅ 記事取得成功: ${title}`);
      
      return {
        url,
        title,
        content,
        publishedDate,
        author,
        siteName,
        ogImage,
        description
      };
    } catch (error) {
      console.error('❌ 記事の取得に失敗:', error);
      throw error;
    }
  }
  
  // タイトル抽出
  private extractTitle($: cheerio.Root): string {
    const title = 
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      $('h1').first().text() ||
      '無題';
    
    return title.trim();
  }
  
  // 本文抽出
  private extractContent($: cheerio.Root): string {
    // 不要な要素を削除
    $('script, style, nav, header, footer, aside, iframe').remove();
    
    // 一般的な記事本文のセレクタを試す
    const selectors = [
      'article',
      'main article',
      '[role="main"]',
      '.article-body',
      '.article-content',
      '.entry-content',
      '.post-content',
      '.content-body',
      '.main-content',
      '.story-body',
      '.ArticleBody',
      'div[itemprop="articleBody"]',
      'main'
    ];
    
    let content = '';
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text();
        if (content.length > 100) {  // 十分な長さの本文が見つかったら採用
          break;
        }
      }
    }
    
    // フォールバック：段落を集める
    if (!content || content.length < 100) {
      content = $('p').map((_, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 30)  // 短い段落は除外
        .join('\n\n');
    }
    
    // クリーンアップ
    return this.cleanupText(content);
  }
  
  // テキストのクリーンアップ
  private cleanupText(text: string): string {
    return text
      .replace(/\s+/g, ' ')           // 連続する空白を1つに
      .replace(/\n{3,}/g, '\n\n')     // 3つ以上の改行を2つに
      .replace(/\t/g, ' ')            // タブをスペースに
      .trim()
      .substring(0, 5000);            // 最大5000文字に制限
  }
  
  // 日付抽出
  private extractDate($: cheerio.Root): string | undefined {
    const dateString = 
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[property="article:published"]').attr('content') ||
      $('meta[name="publishdate"]').attr('content') ||
      $('meta[name="publish_date"]').attr('content') ||
      $('time').first().attr('datetime') ||
      $('time[pubdate]').attr('datetime') ||
      $('.date').first().text() ||
      $('.published').first().text();
    
    if (dateString) {
      try {
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch (e) {
        // 日付のパースに失敗した場合は undefined を返す
      }
    }
    
    return undefined;
  }
  
  // 著者抽出
  private extractAuthor($: cheerio.Root): string | undefined {
    const author = 
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('meta[name="twitter:creator"]').attr('content') ||
      $('[rel="author"]').first().text() ||
      $('.author').first().text() ||
      $('.by-author').first().text() ||
      $('.byline').first().text();
    
    return author ? author.trim() : undefined;
  }
  
  // サイト名抽出
  private extractSiteName($: cheerio.Root): string | undefined {
    const siteName = 
      $('meta[property="og:site_name"]').attr('content') ||
      $('meta[name="application-name"]').attr('content') ||
      $('meta[name="publisher"]').attr('content');
    
    return siteName ? siteName.trim() : undefined;
  }
  
  // OGP画像抽出
  private extractOgImage($: cheerio.Root): string | undefined {
    return $('meta[property="og:image"]').attr('content') ||
           $('meta[name="twitter:image"]').attr('content');
  }
  
  // 説明抽出
  private extractDescription($: cheerio.Root): string | undefined {
    const description = 
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content');
    
    return description ? description.trim() : undefined;
  }
}