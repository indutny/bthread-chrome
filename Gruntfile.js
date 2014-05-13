module.exports = function(grunt) {
  grunt.initConfig({
    watch: {
      files: [ 'lib/**/*.js' ],
      tasks: [ 'browserify' ]
    },
    browserify: {
      bg: {
        src: [ 'lib/background/**/*.js' ],
        dest: 'chrome/dist/bg.js'
      },
      wnd: {
        src: [ 'lib/app/**/*.js' ],
        dest: 'chrome/dist/app.js'
      }
    },
    uglify: {
      mangle: {
      },
      compress: {
        dead_code: true
      },
      build: {
        files: [{
          src: 'chrome/dist/bg.js',
          dest: 'chrome/dist/bg.min.js'
        }, {
          src: 'chrome/dist/app.js',
          dest: 'chrome/dist/app.min.js'
        }]
      }
    }
  });

  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-uglify');

  grunt.registerTask('default', [ 'watch', 'browserify', 'uglify' ]);
};
