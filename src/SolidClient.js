const { resolve, parse: parseUrl } = require('url');
const https = require('https');
const querystring = require('querystring');
const RelyingParty = require('@trust/oidc-rp');
const PoPToken = require('@trust/oidc-rp/lib/PoPToken');

// Fake redirect URL
const redirectUrl = 'http://example.org/';

class SolidClient {
  /**
   * Logs the user in with the given identity provider
   *
   * @param identityProvider string The URL of the identity provider
   * @param credentials object An object with username and password keys
   *
   * @returns Promise<Session> A session for the given user
   */
  async login(identityProvider, credentials) {
    // Set up the relying party
    const relyingParty = await this.getRelyingParty(identityProvider);

    // Obtain the authorization URL
    const authData = {};
    const authUrl = await relyingParty.createRequest({ redirect_uri: redirectUrl }, authData);

    // Perform the login
    const loginParams = await this.getLoginParams(authUrl);
    const accessUrl = await this.performLogin(loginParams.loginUrl, loginParams, credentials);
    const session = await relyingParty.validateResponse(accessUrl, authData);

    return session;
  }

  /**
   * Creates an access token for the given URL.
   *
   * @param url string
   * @param session Session
   *
   * @returns Promise<string> An access token
   */
  async createToken(url, session) {
    return PoPToken.issueFor(url, session);
  }

  /**
   * Obtains a relying party for the given identity provider.
   *
   * @param identityProvider string The URL of the identity provider
   *
   * @returns Promise<RelyingParty> A relying party
   */
  async getRelyingParty(identityProvider) {
    // TODO: reuse when possible, only register when necessary
    return this.registerRelyingParty(identityProvider);
  }

  /**
   * Registers a relying party for the given identity provider.
   *
   * @param identityProvider string The URL of the identity provider
   *
   * @returns Promise<RelyingParty> A relying party
   */
  async registerRelyingParty(identityProvider) {
    const responseType = 'id_token token';
    const registration = {
      issuer: identityProvider,
      grant_types: ['implicit'],
      redirect_uris: [redirectUrl],
      response_types: [responseType],
      scope: 'openid profile',
    };
    const options = {
      defaults: {
        authenticate: {
          redirect_uri: redirectUrl,
          response_type: responseType,
        },
      },
    };
    return RelyingParty.register(identityProvider, registration, options);
  }

  /**
   * Obtains the login parameters through the given authentication URL.
   *
   * @param authUrl String The authentication URL
   *
   * @returns Promise<object> A key/value object of login parameters
   */
  async getLoginParams(authUrl) {
    // Retrieve the login page in HTML
    const authorizationPage = await this.fetch(authUrl);
    const loginPageUrl = resolve(authUrl, authorizationPage.headers.location);
    const loginPage = await this.fetch(loginPageUrl);

    // Extract the password form's target URL
    const passwordForm = loginPage.body.match(/<form[^]*?<\/form>/)[0];
    const loginUrl = resolve(loginPageUrl, passwordForm.match(/action="([^"]+)"/)[1]);

    // Extract the password form's hidden fields
    const loginParams = { loginUrl };
    let match, inputRegex = /<input.*?name="([^"]+)".*?value="([^"]+)"/g;
    while (match = inputRegex.exec(passwordForm))
      loginParams[match[1]] = match[2];

    return loginParams;
  }

  /**
   * Sends the login information to the login page.
   *
   * @param loginUrl string The URL of the login page
   * @param loginParams object The login parameters
   * @param credentials object The user's credentials
   *
   * @returns Promise<string> An access URL.
   */
  async performLogin(loginUrl, loginParams, credentials) {
    loginParams.username = credentials.username;
    loginParams.password = credentials.password;

    const options = parseUrl(loginUrl);
    const postData = querystring.stringify(loginParams);
    options.method = 'POST';
    options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length,
    };
    const loginResponse = await this.fetch(options, postData);
    const authUrl = loginResponse.headers.location;
    const cookie = loginResponse.headers['set-cookie'][0].replace(/;.*/, '');
    const authResponse = await this.fetch(Object.assign(parseUrl(authUrl), {
      headers: { cookie },
    }));

    const accessUrl = authResponse.headers.location;
    return accessUrl;
  }

  /**
   * Fetches the given resource over HTTP.
   *
   * @param options object The request options
   * @param data? string The request body
   *
   * @returns Promise<Response> The HTTP response with a body property
   */
  fetch(options, data) {
    return new Promise((resolve, reject) => {
      const request = https.request(options);
      request.end(data);
      request.on('response', response => {
        response.body = '';
        response.on('data', data => response.body += data);
        response.on('end', () => resolve(response));
      });
      request.on('error', reject);
    });
  }
}

module.exports = SolidClient;
