import fs from 'fs';
import pdfParse from 'pdf-parse';

const dataBuffer = fs.readFileSync('postholders.pdf');

pdfParse(dataBuffer).then(function(data) {
    fs.writeFileSync('pdf_output.txt', data.text);
    console.log('PDF text extracted to pdf_output.txt');
});