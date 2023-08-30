const http = require('http');
const net = require('net');
const url = require('url');
const RediSClient = require('./redis');
const configObject = require("./config.json");


const red = "\x1b[31m";
const green = "\x1b[32m";
const reset = "\x1b[0m";

let totalPass = 0;
let totalRejected = 0;


const Reject = (data) => {
  console.log(`${red}${data}${reset}`);
}

const Success = (data) => {
  console.log(`${green}${data}${reset}`);
}

// Transparent proxy configuration
const proxyPort = 8080;

// Create a TCP server to handle CONNECT requests (for HTTPS)
const proxyTcpServer = net.createServer((clientSocket) => {
  clientSocket.once('data', async (data) => {
    // Parse the CONNECT request
    const [method, target] = data.toString().split(' ');
    let pastDayCounter;

    const { hostname, port } = url.parse(`//${target}`, false, true);
    const domainRule = configObject[hostname] || null;
    const key = `domain:${hostname}`;
    const value = `${hostname}${Date.now()}`;

    try {
      await RediSClient.PFADD(key, value);
    
      // Use pfCount to retrieve the approximate count from HyperLogLog
      pastDayCounter = await RediSClient.pfCount(key);
    } catch (e) {
      console.log('error in HLL', e);
    }
    

    if (domainRule && pastDayCounter >= domainRule.maxFreeRequestsPerDay) {
      const response = `HTTP/1.1 429 Too Many Requests\r\n` +
                       `X-RateLimit-Limit: ${domainRule.maxFreeRequestsPerDay}\r\n` +
                       `X-RateLimit-Remaining: '0'\r\n` +
                       `X-RateLimit-Reset: Tomorrow :)\r\n` +
                       `X-Blocked-By-Proxy: 'true'\r\n\r\n` +
                       'API limit exceeded for domain: ' + hostname + '. Call count: ' + pastDayCounter;

      // Write the custom response to the client socket
      clientSocket.write(response);
      Reject(`This call is being rejected for Domain: ${hostname} and call count is: ${pastDayCounter}`);
      clientSocket.end(); // Close the clientSocket
      totalRejected++;
      Reject(`TOTAL REJECTED ==> ${totalRejected}`)
      return;
    }

    else {
      // Establish a TCP connection to the target server
      const serverSocket = net.connect(port || 443, hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        // Forward data between client and server
        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
      });
      totalPass++;
      Success(`TOTAL Passed ==> ${totalPass}`)
      Success(`This call is Approved for Domain: ${hostname} and call count is: ${pastDayCounter}`)
      // Listen for serverSocket's 'end' event to close the connection after response
      serverSocket.on('end', () => {
        clientSocket.end(); // Close the clientSocket
      });
      serverSocket.on('error', (error) => {
        console.error('Error in serverSocket:', error);
        clientSocket.end(); // Close the clientSocket
      });
    }
  });
  clientSocket.on('error', (error) => {
    console.error('Error in clientSocket:', error);
    clientSocket.end(); // Close the clientSocket
  });

});

proxyTcpServer.on('error', (error) => {
  console.error('Error in proxyTcpServer:', error);
});

// Start the TCP proxy server
proxyTcpServer.listen(proxyPort, () => {
  console.log(`Transparent TCP proxy listening on port ${proxyPort}`);
});
