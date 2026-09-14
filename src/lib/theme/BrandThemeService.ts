/**
 * BrandThemeService — stores and serves the tenant's chosen brand theme.
 *
 * Deliberately NOT localStorage: a theme picked on the owner's laptop must
 * show up the same way on their phone, for every admin staff member, and
 * on the public storefront for every customer. One saved record, read by
 * everyone.
 */
import { NexusDB } from '../database/NexusDB';
import { BrandInput, derivePalette, DerivedPalette, PALETTE_PRESETS } from './colorEngine';

const COLLECTION = 'system_settings';
const DOC_ID = 'brand_theme';

export interface SavedTheme extends BrandInput {
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_THEME: SavedTheme = { primary: '#E67E22', secondary: '#2F5233' };

export class BrandThemeService {
  static async get(): Promise<SavedTheme> {
    const doc = await NexusDB.get(COLLECTION, DOC_ID);
    if (!doc) return DEFAULT_THEME;
    return { primary: doc.primary ?? DEFAULT_THEME.primary, secondary: doc.secondary, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
  }

  static async set(input: BrandInput, updatedBy?: string): Promise<SavedTheme> {
    if (!/^#[0-9a-fA-F]{3,6}$/.test(input.primary)) {
      throw new Error('Invalid primary color — expected a hex value like #E67E22');
    }
    if (input.secondary && !/^#[0-9a-fA-F]{3,6}$/.test(input.secondary)) {
      throw new Error('Invalid secondary color — expected a hex value like #2F5233');
    }
    const record: SavedTheme = { primary: input.primary, secondary: input.secondary, updatedAt: new Date().toISOString(), updatedBy };
    await NexusDB.set(COLLECTION, DOC_ID, record);
    return record;
  }

  static async reset(): Promise<SavedTheme> {
    await NexusDB.set(COLLECTION, DOC_ID, DEFAULT_THEME);
    return DEFAULT_THEME;
  }

  /** Full derived palette for both UI modes, ready for the frontend to apply directly. */
  static async getDerivedPalettes(): Promise<{ theme: SavedTheme; dark: DerivedPalette; light: DerivedPalette }> {
    const theme = await this.get();
    return {
      theme,
      dark: derivePalette({ ...theme, mode: 'dark' }),
      light: derivePalette({ ...theme, mode: 'light' }),
    };
  }

  static getPresets() {
    return PALETTE_PRESETS;
  }
}
