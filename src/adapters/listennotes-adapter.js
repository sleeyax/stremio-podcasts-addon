const BaseAdapter = require("./base-adapter");
const ListenNotes = require("../providers/listennotes");
const helpers = require("../helpers");

class ListenNotesAdapter extends BaseAdapter{
    constructor() {
        super();
        this.provider = new ListenNotes(process.env.LISTEN_NOTES_API_KEY);
    }

    async getGenres() {
        const categories = await this.provider.getAllCategories();
        const genres =  categories.genres
            .map(category => category.name.replace("&", "and"))
            .sort();
        return ["Random"].concat(genres); // unshift not working for some reason
    }

    /**
     * Translate an array of genre ids to an array of genre names
     * @param ids
     *
     */
    async idsToGenres(ids) {
        return (await this.provider.getAllCategories()).genres
            .filter(category => ids.indexOf(category.id) > -1)
            .map(category => category.name);
    }

    /**
     * Loop through all podcasts, until everything is found (infinite scroll)
     * @param skip
     * @param genre: null
     * @return {Promise<Array>}
     */
    async getPodcasts(skip, genre = null) {
        let page = Math.floor(skip / 50);
        let collection = [];
        let hasNext = false;
        do {
            const res = genre === null ? await this.provider.getTopPodcasts(page) : await this.provider.getPodCasts(genre, page);
            collection = collection.concat(res.podcasts);
            hasNext = res.has_next;
            page++;
        } while (hasNext && collection.length <= skip);

        return collection;
    }

    /**
     * Search specific podcast
     * @param query
     * @param pages
     * @return {Promise<Array>}
     */
    async searchPodcasts(query, pages) {
        let collection = [];
        let offset = 0;
        for (let i=0; i<=pages; i++) {
            const res = await this.provider.searchPodCasts(query, offset);
            collection = collection.concat(res.results);
            offset += res.next_offset;
        }
        return collection;
    }

    /**
     * Append ALL episodes to an existing podcast meta data object
     * This will keep calling the API until all episodes are retrieved
     * @param podcast
     * @return {Promise<*>}
     */
    async appendPodcastEpisodes(podcast) {
        let latest = podcast.latest_pub_date_ms;
        let next = podcast.next_episode_pub_date;

        while (latest > next) {
            const meta = await this.provider.getPodCastInfo(podcast.id, next);
            podcast.episodes = podcast.episodes.concat(meta.episodes);
            next = meta.next_episode_pub_date;
        }

        return podcast;
    }

    /**
     * Returns a single random podcast episode as a meta preview object
     * @return {Promise<{genres: string[], director: *[], background: string | SVGImageElement, releaseInfo: string, name: *, posterShape: string, logo: *, description: string | string, id: string, type: string, poster: *}[]>}
     */
    async getRandomPodcast() {
        const collection = [await this.provider.getRandomPodcast()];
        return collection.map(podcast => {
            return {
                id: "podcasts_listennotes_" + podcast.podcast_id,
                type: "series",
                genres: [
                    `<strong>Length: </strong> ${Math.floor(podcast.audio_length_sec / 60)} minutes`,
                    `<strong>Explicit content: </strong> ${podcast.explicit_content ? 'yes' : 'no'}`,
                    `<i>Powered by listen notes</i>`
                ],
                director: [podcast.publisher],
                releaseInfo: `${helpers.getFullYear(podcast.pub_date_ms)}`,
                name: podcast.title,
                poster: podcast.thumbnail,
                posterShape: "square",
                background: podcast.image,
                logo: podcast.thumbnail,
                description: podcast.description,
            }
        });
    }

    /**
     * Calculates the average episode length in minutes
     * @param episodes
     * @return number
     */
    calcAverageEpisodeLength(episodes) {
        let totalSeconds = 0;
        episodes.forEach(episode => {
            totalSeconds += episode.audio_length_sec;
        });

        return Math.floor((totalSeconds / episodes.length) / 60);
    }

    formatReleaseInfo(beginYear, endYear) {
        return beginYear === endYear ? beginYear : `${beginYear}-${endYear}`;
    }

    async getSummarizedMetaDataCollection(args) {
        const skip = args.extra.skip || 50;

        let collection = [];
        if (args.extra.search) {
            // search
            collection = await this.searchPodcasts(args.extra.search, 3);
        }else if (args.extra.genre != null) {
            // random podcast
            if (args.extra.genre === "Random")
                return this.getRandomPodcast();

            // filter by genre
            const selectedGenre = (await this.provider.getAllCategories()).genres.find(category => category.name.replace("&", "and") === args.extra.genre);
            collection = await this.getPodcasts(skip, selectedGenre.id);
        }else{
            // top podcasts
            collection = await this.getPodcasts(skip);
        }

        // Nothing found
        if (collection.length === 0)
            return collection;

        return collection.map(podcast => {
            return {
                id: "podcasts_listennotes_" + podcast.id,
                type: "series",
                genres: [
                    `<strong>Episodes: </strong> ${podcast.total_episodes}`,
                    `<strong>Country: </strong> ${podcast.country}`,
                    `<strong>Language: </strong> ${podcast.language}`,
                    `<strong>Explicit content: </strong> ${podcast.explicit_content ? 'yes' : 'no'}`,
                    `<i>Powered by listen notes</i>`
                ],
                director: [podcast.publisher],
                releaseInfo: this.formatReleaseInfo(helpers.getFullYear(podcast.earliest_pub_date_ms), helpers.getFullYear(podcast.latest_pub_date_ms)),
                name: podcast.title,
                poster: podcast.thumbnail,
                posterShape: "square",
                background: podcast.image,
                logo: podcast.thumbnail,
                description: podcast.description,
            }
        });
    }

    async getMetaData(args) {
        const id = args.id.split("_")[2];
        const metadata = await this.appendPodcastEpisodes(await this.provider.getPodCastInfo(id));

        return Promise.resolve({
            meta: {
                id: args.id,
                type: "series",
                name: metadata.title,
                genres: await this.idsToGenres(metadata.genre_ids),
                runtime: `${ this.formatReleaseInfo(helpers.getFullYear(metadata.earliest_pub_date_ms), helpers.getFullYear(metadata.latest_pub_date_ms))} | Average episode length: ${this.calcAverageEpisodeLength(metadata.episodes)} minutes`,
                poster: metadata.thumbnail,
                posterShape: "square",
                background: metadata.image,
                logo: metadata.thumbnail,
                description: metadata.description,
                videos: metadata.episodes.map((episode, i) => {
                    return {
                        id: "podcasts_listennotes_" + episode.id,
                        title: episode.title,
                        released: new Date(episode.pub_date_ms).toISOString(),
                        season: 1,
                        episode: i + 1,
                        thumbnail: episode.thumbnail,
                        streams: [{url: episode.audio}],
                        overview: episode.description
                    }
                }),
                director: [metadata.publisher],
                language: metadata.language,
                country: metadata.country,
                website: metadata.website
            },
            cacheMaxAge: 3 * (24 * 3600)
        });
    }

    async getStreams(args) {
        const id = args.id.split("_")[2];
        const episode = await this.provider.getEpisodes(id);

        const streams = [{
            url: episode.audio,
            title: "audio"
        }, {
            externalUrl: episode.listennotes_url,
            title: "source"
        }];


        for (let key in episode.podcast.extra) {
            const value = episode.podcast.extra[key];

            if (key.indexOf("_") > -1) {
                const name = key.split("_")[0];
                const type = key.split("_")[1];
                switch (type) {
                    case "url":
                        if (name === "youtube") {
                            streams.push({
                                ytid: value.split("?v=")[1],
                                title: name
                            });
                            break;
                        }

                        value && streams.push({
                            externalUrl: value,
                            title: name
                        });
                        break;
                    case "handle":
                        value && streams.push({
                            externalUrl: `https://${name}.com/${value}`,
                            title: name
                        });
                        break;
                    default:
                        break;
                }
            }
        }

        return Promise.resolve({streams: streams, cacheMaxAge: (24 * 3600) * 3});
    }
}

module.exports = ListenNotesAdapter;
