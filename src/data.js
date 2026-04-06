// Exportamos la matriz principal de proyectos
export const categoryPlanetData = [
  { 
    id: 1, 
    title: { es: 'GameLab Tadeo', en: 'Tadeo GameLab' }, 
    role: { es: 'Director / Lead Researcher', en: 'Director / Lead Researcher' },
    tech: { es: ['Investigación', 'Game Design', 'Gestión Académica', 'WebXR'], en: ['Research', 'Game Design', 'Academic Management', 'WebXR'] },
    desc: { es: 'Nodo de Investigación y Desarrollo Interactivo.', en: 'Interactive Research and Development Node.' }, 
    color: 0xff0055, 
    gallery: ["/imge/chaplin.jpg", "/imge/gamber.png","/imge/zenova.jpg", "/imge/ley_1.jpg"],
    videos: ['https://www.youtube.com/embed/7AU-kRzSwIk?si=_mQ7bBEBZRR0R1vU', "/imge/zonar.mp4","/imge/Asteroide2.mp4"],
    link: 'https://www.instagram.com/gamelabtadeo/',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">El <strong>GameLab Tadeo</strong> es un ecosistema completo donde investigamos cómo las mecánicas pueden transformar realidades...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;"><strong>Tadeo GameLab</strong> is a complete ecosystem where we research how mechanics can transform realities...</p>`
    }
  },
  { 
    id: 2, 
    title: { es: 'Consola Arduino', en: 'Arduino Console' }, 
    role: { es: 'Hardware & Software Developer', en: 'Hardware & Software Developer' },
    tech: { es: ['Arduino', 'C++', 'Impresión 3D', 'Electrónica'], en: ['Arduino', 'C++', '3D Printing', 'Electronics'] },
    desc: { es: 'Mini-consola portátil construida desde cero.', en: 'Portable mini-console built from scratch.' }, 
    color: 0x00aaff, 
    gallery: ['/imge/chaplin.jpg', '/imge/gamelab-2.jpg'], 
    videoSrc: 'https://www.youtube.com/embed/7AU-kRzSwIk?si=_mQ7bBEBZRR0R1vU', 
    link: 'https://www.utadeo.edu.co/es',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Proyecto doctoral. Desarrollo enfocado en el diseño de hardware interactivo partiendo desde los componentes más básicos...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Doctoral project. Development focused on interactive hardware design starting from the most basic components...</p>`
    }
  },
  { 
    id: 3, 
    title: { es: 'MediaLab Cinemateca', en: 'Cinemateca MediaLab' }, 
    role: { es: 'Coordinador & Curador', en: 'Coordinator & Curator' },
    tech: { es: ['Gestión Cultural', 'Nuevos Medios', 'Co-creación'], en: ['Cultural Management', 'New Media', 'Co-creation'] },
    desc: { es: 'Coordinador del MediaLab y curaduría MediaExp.', en: 'MediaLab Coordinator and MediaExp curation.' }, 
    color: 0x00ffaa, 
    gallery: ['https://via.placeholder.com/800x600/00ffaa/000000?text=MediaLab+1'], 
    videoSrc: '',
    link: 'https://cinematecadebogota.gov.co/',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Impulso a la experimentación con medios interactivos y artes audiovisuales...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Fostering experimentation with interactive media and audiovisual arts...</p>`
    }
  },
  { 
    id: 4, 
    title: { es: 'Docencia en Diseño', en: 'Design Teaching' }, 
    role: { es: 'Profesor de Planta', en: 'Full-time Professor' },
    tech: { es: ['Pedagogía', 'Arte Interactivo', 'Diseño Crítico'], en: ['Pedagogy', 'Interactive Art', 'Critical Design'] },
    desc: { es: 'Convergencia entre tecnología, arte y diseño.', en: 'Convergence between technology, art, and design.' }, 
    color: 0xffff00, 
    gallery: ['https://via.placeholder.com/800x600/ffff00/000000?text=Clase+1'], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Herramientas conceptuales para materializar ideas en el aula...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Conceptual tools to materialize ideas in the classroom...</p>`
    }
  },
  { 
    id: 5, 
    title: { es: 'Games for Change', en: 'Games for Change' }, 
    role: { es: 'Game Designer', en: 'Game Designer' },
    tech: { es: ['Impacto Social', 'Mecánicas Lúdicas', 'Resolución de Conflictos'], en: ['Social Impact', 'Game Mechanics', 'Conflict Resolution'] },
    desc: { es: 'Videojuegos como herramientas de transformación.', en: 'Video games as tools for transformation.' }, 
    color: 0xff8800, 
    gallery: ['https://via.placeholder.com/800x600/ff8800/000000?text=Juego+1'], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Análisis de reglas estructuradas que fomentan la empatía...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Analysis of structured rules that foster empathy...</p>`
    }
  },
  { 
    id: 6, 
    title: { es: 'TouchDesigner & VR', en: 'TouchDesigner & VR' }, 
    role: { es: 'Technical Artist / Prototyper', en: 'Technical Artist / Prototyper' },
    tech: { es: ['TouchDesigner', 'Realidad Virtual', 'Nodos / Paramétrico'], en: ['TouchDesigner', 'Virtual Reality', 'Nodes / Parametric'] },
    desc: { es: 'Exploración en nuevos medios e interactividad.', en: 'Exploration in new media and interactivity.' }, 
    color: 0xaa00ff, 
    gallery: ['https://via.placeholder.com/800x600/aa00ff/ffffff?text=TouchDesigner+1'], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Prototipado inmersivo para diluir la frontera física/digital...</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Immersive prototyping to blur the physical/digital boundary...</p>`
    }
  },
  { 
    id: 7, 
    isFolder: true, 
    title: { es: 'DIR: /Galería_Archivos', en: 'DIR: /File_Gallery' }, 
    desc: { es: 'Base de datos fotográfica y videográfica.', en: 'Photographic and videographic database.' }, 
    color: 0xffaa00, 
    gallery: ['https://via.placeholder.com/800x600/ffaa00/000000?text=Archivo+Foto+1', 'https://via.placeholder.com/800x600/cc8800/000000?text=Archivo+Foto+2', 'https://via.placeholder.com/800x600/aa6600/000000?text=Archivo+Foto+3'], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Directorio de assets, prototipos fallidos y experimentaciones visuales descartadas a lo largo de los años.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Asset directory, failed prototypes, and discarded visual experimentations over the years.</p>`
    }
  },
  { 
    id: 8, 
    title: { es: 'Módulo WebAR', en: 'WebAR Module' }, 
    desc: { es: 'Integración de Realidad Aumentada Funcional.', en: 'Integration of Functional Augmented Reality.' }, 
    color: 0xff00ff, 
    gallery: ['https://via.placeholder.com/800x600/ff00ff/ffffff?text=WebAR+1', 'https://via.placeholder.com/800x600/cc00cc/ffffff?text=WebAR+2'], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Proyectos que anclan geometrías digitales en el mundo real utilizando estándares abiertos web (WebXR, Three.js).</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Projects that anchor digital geometries in the real world using open web standards (WebXR, Three.js).</p>`
    }
  }
];

export const whaleData = { 
  id: 99, 
  title: { es: 'LOG_WHL // BESTIARIO', en: 'LOG_WHL // BESTIARY' }, 
  desc: { es: 'Entidad "Ballena Cósmica". Un cúmulo residual de datos masivos que navega por la caché profunda.', en: 'Entity "Cosmic Whale". A residual cluster of massive data navigating the deep cache.' }, 
  longDesc: { es: 'Nuestros escáneres indican que esta entidad pacífica limpia archivos corruptos a su paso. Es un remanente de una versión antigua del sistema operativo.', en: 'Scanners indicate this peaceful entity cleans corrupt files in its wake. It is a remnant of an older OS version.' }, 
  mediaType: 'image', 
  mediaSrc: 'https://images.unsplash.com/photo-1614729939124-032f0b56c9ce?w=600&q=80', 
  link: '', 
  originalColor: 0xffffff 
};