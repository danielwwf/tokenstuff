const xrpl = require('xrpl');

async function getTopTokenHolders(issuerAddress, currencyHex, limit = 50) {
  const client = new xrpl.Client('wss://s1.ripple.com');
  let holders = [];

  try {
    await client.connect();

    let marker = null;
    do {
      // Fetch trustlines with pagination support
      const response = await client.request({
        command: 'account_lines',
        account: issuerAddress,
        limit: 400,
        marker: marker || undefined
      });

      console.log(`Fetched ${response.result.lines.length} lines`);

      // Filter for the specified currency using HEX code and non-zero balance
      const filteredLines = response.result.lines.filter(
        line => line.currency === currencyHex && parseFloat(line.balance) !== 0
      );

      console.log(`Filtered ${filteredLines.length} lines for currency HEX ${currencyHex} with non-zero balance`);
      
      holders.push(...filteredLines);

      // Set marker for pagination, if valid
      marker = typeof response.result.marker === 'string' ? response.result.marker : null;
    } while (marker); // Continue if there's more data

    if (holders.length === 0) {
      console.log('No trustlines found for this issuer and currency code with non-zero balances.');
      return;
    }

    // Sort holders by absolute balance in descending order and limit to the top N
    holders = holders
      .sort((a, b) => Math.abs(parseFloat(b.balance)) - Math.abs(parseFloat(a.balance)))
      .slice(0, limit);

    console.log(`Top ${limit} Holders of ${currencyHex} Issued by ${issuerAddress}:`);
    holders.forEach((holder, index) => {
      console.log(`${index + 1}. Address: ${holder.account}, Balance: ${Math.abs(parseFloat(holder.balance))}`);
    });
  } catch (error) {
    console.error('Error fetching trustlines:', error.message);
  } finally {
    client.disconnect();
  }
}

// Replace with the issuer's account and token HEX code
const issuerAddress = 'raw8HMgut65WkCG3Gs5XcGFG1pPNVZLdyK';
const currencyHex = '5854415244494F00000000000000000000000000'; // XTARDIO in HEX
getTopTokenHolders(issuerAddress, currencyHex);
