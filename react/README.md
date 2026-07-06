# ozon-formio React

Root pulita per il porting React in `ozon-env-app-r`.

## Docker

```bash
cp .env.example .env
./app_manager.sh build
./app_manager.sh start
./app_manager.sh stop
```

`app_manager.sh start` esegue sempre prima la build dell'immagine e poi avvia il servizio.
