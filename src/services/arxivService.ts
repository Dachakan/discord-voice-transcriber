import axios from 'axios';
import * as xml2js from 'xml2js';

export interface ArxivPaper {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    published: Date;
    updated: Date;
    arxivId: string;
    pdfUrl: string;
    categories: string[];
    primaryCategory: string;
}

export class ArxivService {
    private readonly API_URL = 'http://export.arxiv.org/api/query';
    private searchResults: ArxivPaper[] = [];

    async searchPapers(query: string, maxResults: number = 10): Promise<ArxivPaper[]> {
        try {
            const params = {
                search_query: query,
                start: 0,
                max_results: maxResults,
                sortBy: 'submittedDate',
                sortOrder: 'descending'
            };

            const response = await axios.get(this.API_URL, { params });
            const papers = await this.parseArxivResponse(response.data);
            
            // 検索結果を保存（後で番号選択するため）
            this.searchResults = papers;
            return papers;
        } catch (error) {
            console.error('arXiv検索エラー:', error);
            throw new Error('論文の検索に失敗しました');
        }
    }

    async parseArxivResponse(xmlData: string): Promise<ArxivPaper[]> {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlData);
        
        const entries = result.feed.entry || [];
        
        return entries.map((entry: any) => {
            const arxivId = entry.id[0].split('/abs/')[1].split('v')[0];
            
            return {
                id: entry.id[0],
                title: entry.title[0].replace(/\s+/g, ' ').trim(),
                authors: entry.author ? entry.author.map((a: any) => a.name[0]) : [],
                abstract: entry.summary[0].replace(/\s+/g, ' ').trim(),
                published: new Date(entry.published[0]),
                updated: new Date(entry.updated[0]),
                arxivId: arxivId,
                pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
                categories: entry.category ? entry.category.map((c: any) => c.$.term) : [],
                primaryCategory: entry['arxiv:primary_category'] ? 
                    entry['arxiv:primary_category'][0].$.term : ''
            };
        });
    }

    getSearchResult(index: number): ArxivPaper | null {
        if (index >= 0 && index < this.searchResults.length) {
            return this.searchResults[index];
        }
        return null;
    }

    clearSearchResults(): void {
        this.searchResults = [];
    }
}