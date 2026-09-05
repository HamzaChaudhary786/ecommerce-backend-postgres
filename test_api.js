import fetch from 'node-fetch';

async function run() {
  try {
    const res = await fetch('http://localhost:5000/api/v1/listings?status=active&page=1&countries=Pakistan');
    const data = await res.json();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
}

run();
