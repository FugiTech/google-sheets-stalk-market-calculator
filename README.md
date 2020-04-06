A Google App Script to manage Animal Crossing New Horizon's Stalk Market predictions

Original Reverse Engineering done by Treeki  
https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b  
https://twitter.com/_Ninji/status/1244818665851289602

Conversion to Javascript by Mike Bryant  
https://twitter.com/LeaChimUK/status/1245078620948828161  
https://mikebryant.github.io/ac-nh-turnip-prices/index.html

Original Google App Script implementation by the following  
Matthew Conto <https://github.com/drfuzzyness>  
Jeffrey Hu <https://github.com/jyh947>  
Jonathan Ames 

Heavily modified for multiple users & including probable price  
Chris Gamble <https://github.com/Fugiman>

This script predicts a range of stock prices for times you don't have data for. It can handle any
amount of missing data, but the more you have the more accurate it will be. Output is in the format
of "[lowest possible price]-[most likely price]-[highest possible price]".

To get the "most likely price" and to not rely on any random state, this script brute forces each possible
series of prices and removes the ones that don't match the data you've entered. This can be pretty slow, but will complete eventually.

# Copy the spreadsheet:
https://docs.google.com/spreadsheets/d/1TF66LVbU9THe0p64KMfeg3tvywpEIC_-9VfjeCAvA7E/copy

Spreadsheet originally by https://twitter.com/SmallLady0

![Spreadsheet example](https://i.imgur.com/PbFFa7U.png)
