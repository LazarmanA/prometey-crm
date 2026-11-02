const fs=require('fs');const path=require('path');
const root=__dirname;fs.copyFileSync(path.join(root,'storage','data.demo.json'),path.join(root,'storage','data.json'));
console.log('Демо-данные ПРОМЕТЕЯ восстановлены.');
