import Trakt, {
  TraktAccessExport, TraktIds, TraktItem, TraktList, TraktOptions, TraktType, UsersListItemsAddRemove,
} from 'trakt.tv';
import fs from 'fs';
import { logger, Utils } from '../Utils';
import { FlixPatrolPlatform, FlixPatrolTMDBIds, FlixPatrolType } from '../Flixpatrol';

export class TraktAPI {
  private trakt: Trakt;

  private readonly traktSaveFile: string;

  constructor(options: TraktOptions, traktSaveFile: string) {
    this.trakt = new Trakt(options);
    this.traktSaveFile = traktSaveFile;
  }

  public async connect() {
    if (fs.existsSync(this.traktSaveFile)) {
      logger.info(`Loading trakt informations from file ${this.traktSaveFile}`);
      const data = fs.readFileSync(this.traktSaveFile, 'utf8');
      const token: TraktAccessExport = JSON.parse(data);
      this.trakt.import_token(token).then((newTokens) => {
        logger.debug(`Trakt informations from file ${this.traktSaveFile} loaded`);
        fs.writeFileSync(this.traktSaveFile, JSON.stringify(newTokens));
        logger.debug(`Trakt informations saved to file ${this.traktSaveFile}`);
      });
    } else {
      logger.info(`No trakt file ${this.traktSaveFile} found, initializing a new trakt connection`);
      const traktCode = this.trakt.get_codes().then((poll) => {
        logger.info(`Please open the verification url: ${poll.verification_url}`);
        logger.info(`And enter the following code: ${poll.user_code}`);
        return this.trakt.poll_access(poll);
      });
      traktCode.then(() => {
        logger.info('Your are now connected to Trakt');
        const token = this.trakt.export_token();
        fs.writeFileSync(this.traktSaveFile, JSON.stringify(token));
        logger.debug(`Trakt informations saved to file ${this.traktSaveFile}`);
      });
    }
  }

  private async getList(platform: FlixPatrolPlatform): Promise<TraktList> {
    let list: TraktList;
    try {
      logger.info(`Getting list ${platform}-top10 from trakt`);
      list = await this.trakt.users.list.get({ username: 'me', id: `${platform}-top10` });
    } catch (getErr) {
      if ((getErr as Error).message.includes('404 (Not Found)')) {
        logger.warn(`List ${platform}-top10 was not found on trakt, creating it`);
        try {
          list = await this.trakt.users.lists.create({ username: 'me', name: `${platform}-top10` });
          // Avoid Trakt rate limite
          await Utils.sleep(2000);
        } catch (createErr) {
          logger.error(`Trakt Error (createList): ${(createErr as Error).message}`);
          process.exit(1);
        }
      } else {
        logger.error(`Trakt Error (getList): ${(getErr as Error).message}`);
        process.exit(1);
      }
    }
    return list;
  }

  private async getListItems(list: TraktList, type: TraktType): Promise<TraktItem[]> {
    logger.info(`Getting items from trakt list ${list.ids.slug}`);
    let items: TraktItem[];
    try {
      items = await this.trakt.users.list.items.get({ username: 'me', id: `${list.ids.trakt}`, type });
    } catch (err) {
      logger.error(`Trakt Error (listItems): ${(err as Error).message}`);
      process.exit(1);
    }
    return items;
  }

  private static getItemTraktId(item: TraktItem): number | undefined {
    switch (item.type) {
      case 'movie':
        return item.movie?.ids.trakt;
      case 'show':
        return item.show?.ids.trakt;
      case 'season':
        return item.season?.ids.trakt;
      case 'episode':
        return item.episode?.ids.trakt;
      case 'person':
        return item.person?.ids.trakt;
      default:
        return undefined;
    }
  }

  private async removeListItems(list: TraktList, items: TraktItem[], type: TraktType): Promise<void> {
    logger.info(`Trakt list ${list.ids.slug} contain ${items.length} items of ${type}, removing them`);
    const toRemove: { ids: TraktIds }[] = [];
    items.forEach((item) => {
      const id = TraktAPI.getItemTraktId(item);
      toRemove.push({ ids: { trakt: id } });
    });
    const body: UsersListItemsAddRemove = {
      id: `${list.ids.trakt}`,
      username: 'me',
      movies: [],
      shows: [],
      seasons: [],
      episodes: [],
      people: [],
    };
    if (type === 'movie') {
      body.movies = toRemove;
    } else {
      body.shows = toRemove;
    }
    try {
      await this.trakt.users.list.items.remove(body);
    } catch (err) {
      logger.error(`Trakt Error (removeItems): ${(err as Error).message}`);
      process.exit(1);
    }
  }

  private async addItemsToList(list: TraktList, tmdbIDs: FlixPatrolTMDBIds, type: TraktType) {
    const toAdd: { ids: TraktIds }[] = [];
    tmdbIDs.forEach((tmdbID) => {
      toAdd.push({ ids: { tmdb: parseInt(tmdbID, 10) } });
    });
    const body: UsersListItemsAddRemove = {
      id: `${list.ids.trakt}`,
      username: 'me',
      movies: [],
      shows: [],
      seasons: [],
      episodes: [],
      people: [],
    };
    if (type === 'movie') {
      body.movies = toAdd;
    } else {
      body.shows = toAdd;
    }
    try {
      await this.trakt.users.list.items.add(body);
    } catch (err) {
      logger.error(`Trakt Error (addItems): ${(err as Error).message}`);
      process.exit(1);
    }
  }

  public async pushToList(tmdbIDs: FlixPatrolTMDBIds, platform: FlixPatrolPlatform, type: FlixPatrolType) {
    const traktType: TraktType = type === 'Movies' ? 'movie' : 'show';
    const list = await this.getList(platform);
    const items = await this.getListItems(list, traktType);
    if (items.length > 0) {
      await this.removeListItems(list, items, traktType);
      // Avoid Trakt rate limite
      await Utils.sleep(2000);
    }
    await this.addItemsToList(list, tmdbIDs, traktType);
    // console.log(items);
    // this.trakt.users.lists.create({ });
  }
}
