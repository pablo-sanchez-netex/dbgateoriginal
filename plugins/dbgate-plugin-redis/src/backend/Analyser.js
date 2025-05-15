const { DatabaseAnalyser, getLogger } = global.DBGATE_PACKAGES['dbgate-tools'];
const jwt = require('jsonwebtoken');

const logger = getLogger('redisAnalyser');

class Analyser extends DatabaseAnalyser {
  constructor(dbhan, driver) {
    super(dbhan, driver);
  }

  feedback(obj, extraObject = {}) {
    // Log authorization header status
    if (!this.dbhan.req?.headers?.authorization) {
      logger.debug({
        msg: 'Analyser feedback - No authorization header found'
      });
    }

    // Add user info to message if available
    let message = obj.analysingMessage;
    let hasUserInfo = false;
    let user = null;

    if (this.dbhan.req?.headers?.authorization) {
      try {
        const token = this.dbhan.req.headers.authorization.split(' ')[1];
        const decoded = jwt.decode(token);
        if (decoded?.login) {
          hasUserInfo = true;
          user = decoded.login;
        }
      } catch (err) {
        logger.error({
          msg: 'Error decoding JWT token in feedback',
          error: err.message
        });
      }
    }

    // Remove the analysingMessage from the obj
    delete obj.analysingMessage;
    super.feedback(obj);

    // Force the logger.debug here with user info
    logger.debug({
      hasUserInfo: hasUserInfo,
      loginUser: user,
      ...extraObject
    }, message);
  }

  async _runAnalysis() {
    // Get the current database number from Redis client
    const info = await this.dbhan.client.info();
    const dbNumber = this.dbhan.client.options.db || 0;
    
    this.feedback({ analysingMessage: `Connected to Redis database ${dbNumber}` });
    
    // Get database statistics
    const dbInfo = info.split('\n')
      .find(line => line.startsWith(`db${dbNumber}`))
      ?.split(':')[1]
      ?.split(',')
      ?.reduce((acc, curr) => {
        const [key, value] = curr.split('=');
        acc[key] = parseInt(value);
        return acc;
      }, {}) || { keys: 0, expires: 0, avg_ttl: 0 };

    this.feedback({ analysingMessage: `Database ${dbNumber} contains ${dbInfo.keys} keys, ${dbInfo.expires} with expiration` }, { database: dbNumber, keys: dbInfo.keys, expires: dbInfo.expires });
    this.feedback({ analysingMessage: 'Loading Redis keys and data structures' });
    
    // Redis analysis implementation would go here
    
    this.feedback({ analysingMessage: `Finalizing Redis database ${dbNumber} structure` });
    return {
      tables: [],
      views: [],
      procedures: [],
      functions: [],
      triggers: []
    };
  }
}

module.exports = Analyser;
