# 1. Start your day - spin up everything
docker-compose up -d --build

# 2. Check everything is running
docker-compose ps

# 3. Watch logs while developing
docker-compose logs -f app

# 4. Make code changes, rebuild only the app
docker-compose up -d --build app

# 5. Test your API
curl http://localhost:3000/health


# 6. End of day - stop everything
docker-compose down

# start 
 docker-compose up -d 