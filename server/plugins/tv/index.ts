import { makeTmdbPlugin } from '../_shared/tmdb-plugin'

/** 电视剧插件：与电影共用 TMDB 实现，只切换 mediaType。 */
export default makeTmdbPlugin('tv')
