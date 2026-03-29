const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const queues = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Tocar música')
    .addStringOption(opt => opt.setName('nome').setDescription('Nome da música').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Pular música'),
  new SlashCommandBuilder().setName('stop').setDescription('Parar tudo')
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
  console.log(`🔥 Online: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  if (!interaction.guild || !interaction.member) {
    return interaction.editReply('❌ Use em servidor.');
  }

  const member = interaction.member;
  if (!member.voice || !member.voice.channel) {
    return interaction.editReply('❌ Entre em um canal de voz!');
  }

  const voiceChannel = member.voice.channel;
  let serverQueue = queues.get(interaction.guild.id);

  try {
    if (interaction.commandName === 'play') {
      const query = interaction.options.getString('nome');
      const result = await play.search(query, { limit: 1 }).catch(() => null);

      if (!result || !result.length) return interaction.editReply('❌ Música não encontrada.');

      const song = { title: result[0].title, url: result[0].url };

      if (!serverQueue) {
        serverQueue = { voiceChannel, connection: null, player: createAudioPlayer(), songs: [] };
        queues.set(interaction.guild.id, serverQueue);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator
        });

        // Aguarda a conexão ficar pronta antes de tocar
        await entersState(connection, VoiceConnectionStatus.Ready, 15000).catch(() => {
          connection.destroy();
          throw new Error('❌ Falha ao conectar ao canal de voz.');
        });

        serverQueue.connection = connection;
        connection.subscribe(serverQueue.player);
      }

      serverQueue.songs.push(song);
      await interaction.editReply(`🎶 Adicionado à fila: **${song.title}**`);

      if (serverQueue.songs.length === 1) {
        playSong(interaction.guild);
      }
    }

    if (interaction.commandName === 'skip') {
      if (!serverQueue) return interaction.editReply('❌ Nada tocando');
      serverQueue.player.stop();
      return interaction.editReply('⏭️ Pulado!');
    }

    if (interaction.commandName === 'stop') {
      if (!serverQueue) return interaction.editReply('❌ Nada tocando');
      serverQueue.songs = [];
      serverQueue.player.stop();
      serverQueue.connection.destroy();
      queues.delete(interaction.guild.id);
      return interaction.editReply('⛔ Parado!');
    }

  } catch (err) {
    console.error(err);
    interaction.editReply(`❌ Erro: ${err.message}`);
  }
});

async function playSong(guild) {
  const serverQueue = queues.get(guild.id);
  if (!serverQueue || !serverQueue.songs.length) {
    if (serverQueue?.connection) serverQueue.connection.destroy();
    queues.delete(guild.id);
    return;
  }

  const song = serverQueue.songs[0];

  try {
    const stream = await play.stream(song.url).catch(() => null);
    if (!stream) {
      serverQueue.songs.shift();
      return playSong(guild);
    }

    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    serverQueue.player.play(resource);

    serverQueue.player.once(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      playSong(guild);
    });

  } catch (err) {
    console.error(err);
    serverQueue.songs.shift();
    playSong(guild);
  }
}

client.login(process.env.TOKEN);